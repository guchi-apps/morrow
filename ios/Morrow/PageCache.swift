import CryptoKit
import Foundation

/// 閲覧した画面の保存（#643）。圏外・低速回線のときに「最後に見た内容」を出すための端末内キャッシュ。
///
/// 保存するのはサーバーが答えた（＝その時点で許可判定を通った）画面の、スクリプトを除いた読み取り専用の
/// スナップショットだけ。**ログイン画面（`/login`）へ着いた時点・ログアウト時には全削除する**
/// （`WebViewModel`）ので、保存時と別の利用者・許可を取り消された後の内容が、次のログイン以降に出ない。
enum PageCache {
    struct Entry: Codable {
        let key: String
        let html: String
        let savedAt: Date
    }

    /// 保存する画面数の上限。超えたら古い順に消す
    static let maxEntries = 30
    /// 保存からこの時間を過ぎたものは表示せず消す（許可の取り消しが圏外のあいだ残る長さの上限でもある）
    static let lifetime: TimeInterval = 3 * 24 * 60 * 60

    /// 保存しない先頭パス。ログイン・認証の往復・APIは画面として残す意味が無く、認証の判定に関わる
    private static let excludedPrefixes = ["/login", "/auth", "/api"]

    private static let lock = NSLock()

    /// 保存・表示の対象になる画面のキー（パス＋クエリ）。対象外なら nil
    static func key(for url: URL) -> String? {
        guard AppConfig.isAppURL(url) else { return nil }
        let path = url.path.isEmpty ? "/" : url.path
        if excludedPrefixes.contains(where: { path == $0 || path.hasPrefix($0 + "/") }) { return nil }
        if let query = url.query, !query.isEmpty { return path + "?" + query }
        return path
    }

    static func save(html: String, for url: URL, now: Date = Date()) {
        guard let key = key(for: url) else { return }
        lock.lock()
        defer { lock.unlock() }
        guard let directory = directory(),
              let data = try? JSONEncoder().encode(Entry(key: key, html: html, savedAt: now))
        else { return }
        try? data.write(
            to: file(for: key, in: directory),
            options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
        )
        prune(in: directory, now: now)
    }

    static func load(for url: URL, now: Date = Date()) -> Entry? {
        guard let key = key(for: url) else { return nil }
        lock.lock()
        defer { lock.unlock() }
        guard let directory = directory() else { return nil }
        let path = file(for: key, in: directory)
        guard let data = try? Data(contentsOf: path),
              let entry = try? JSONDecoder().decode(Entry.self, from: data),
              entry.key == key
        else { return nil }
        if now.timeIntervalSince(entry.savedAt) > lifetime || entry.savedAt > now.addingTimeInterval(60) {
            try? FileManager.default.removeItem(at: path)
            return nil
        }
        return entry
    }

    /// すべて消す。`/login` へ着いたとき・ログアウトのときに呼ぶ
    static func clearAll() {
        lock.lock()
        defer { lock.unlock() }
        guard let directory = directory(create: false) else { return }
        try? FileManager.default.removeItem(at: directory)
    }

    // MARK: - ファイル

    private static func directory(create: Bool = true) -> URL? {
        guard var base = try? FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
        ) else { return nil }
        base.appendPathComponent("PageCache", isDirectory: true)
        if create, !FileManager.default.fileExists(atPath: base.path) {
            guard (try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)) != nil
            else { return nil }
            // 予定・通知の本文を含むので、iCloudバックアップには載せない
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try? base.setResourceValues(values)
        }
        return base
    }

    private static func file(for key: String, in directory: URL) -> URL {
        let digest = SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
        return directory.appendingPathComponent(digest + ".json")
    }

    /// 期限切れを消し、上限を超えた分を古い順に消す
    private static func prune(in directory: URL, now: Date) {
        let keys: [URLResourceKey] = [.contentModificationDateKey]
        guard let files = try? FileManager.default.contentsOfDirectory(
            at: directory, includingPropertiesForKeys: keys
        ) else { return }
        let dated = files.map { url -> (URL, Date) in
            let date = (try? url.resourceValues(forKeys: Set(keys)).contentModificationDate) ?? .distantPast
            return (url, date)
        }
        var alive: [(URL, Date)] = []
        for item in dated {
            if now.timeIntervalSince(item.1) > lifetime {
                try? FileManager.default.removeItem(at: item.0)
            } else {
                alive.append(item)
            }
        }
        let overflow = alive.count - maxEntries
        guard overflow > 0 else { return }
        for item in alive.sorted(by: { $0.1 < $1.1 }).prefix(overflow) {
            try? FileManager.default.removeItem(at: item.0)
        }
    }
}
