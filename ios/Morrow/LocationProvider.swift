import CoreLocation
import WebKit

/// 現在地を端末の位置情報（CoreLocation）から1回だけ取り、Webへ返す口（#1087）。
/// WKWebViewの `navigator.geolocation` はWebKitの確認（iOS 27未満では開くたび）を挟み、取れないことがあったため、
/// 殻がOSの位置許可（「Appを使用中は許可」）で直接取る。**追跡しない・保存しない・サーバーへ送らない**（Webへ返すだけ）。
///
/// Webからは `window.webkit.messageHandlers.morrowLocation.postMessage({})` で呼び、
/// `{ status: "ok", latitude, longitude, accuracy }` か `{ status: "denied" | "failed" }` が返る
/// （`src/lib/geolocation.ts` の `readNativeLocation()` が読む。名前・形を変えるときは両方を揃える）。
/// `postMessage({ query: "permission" })` は位置を取らずに許可の状態だけを `{ permission: "granted" | "prompt" | "denied" }` で返す
/// （許可済みのときだけ開いた時点で取る画面のため。許可を求めない）。
final class LocationBridge: NSObject, WKScriptMessageHandlerWithReply {
    static let handlerName = "morrowLocation"

    private let provider = LocationProvider()

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) async -> (Any?, String?) {
        // Morrow自身のオリジンのメインフレームだけに答える（埋め込みの外部ページへ位置を渡さない）
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame,
              origin.protocol == AppConfig.baseURL.scheme,
              origin.host == AppConfig.baseURL.host
        else { return (["status": "denied", "permission": "denied"], nil) }

        if let body = message.body as? [String: Any], body["query"] as? String == "permission" {
            return (["permission": provider.permission], nil)
        }

        switch await provider.current() {
        case .located(let location):
            return ([
                "status": "ok",
                "latitude": location.coordinate.latitude,
                "longitude": location.coordinate.longitude,
                "accuracy": location.horizontalAccuracy,
            ] as [String: Any], nil)
        case .denied:
            return (["status": "denied"], nil)
        case .failed:
            return (["status": "failed"], nil)
        }
    }
}

/// CLLocationManagerで1回だけ位置を取る。許可が未決定ならその場で求める。10秒で諦める。
/// 同時に来た要求は同じ1回の結果を待つ。
final class LocationProvider: NSObject, CLLocationManagerDelegate {
    enum Outcome {
        case located(CLLocation)
        case denied
        case failed
    }

    /// 直前に取れた位置をこの秒数のあいだ使い回す（開き直すたびにGPSを起こさない）
    private static let reuseInterval: TimeInterval = 5 * 60
    private static let timeout: Duration = .seconds(10)

    private let manager = CLLocationManager()
    private var waiters: [CheckedContinuation<Outcome, Never>] = []
    private var timeoutTask: Task<Void, Never>?
    /// 許可を求めている最中か（決まったら位置の取得へ進む）
    private var awaitingAuthorization = false

    override init() {
        super.init()
        manager.delegate = self
        // 天気の地点（小数2桁≒1km）に足りる精度。高精度より早く返る
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    /// いまの許可の状態（求めない）
    var permission: String {
        switch manager.authorizationStatus {
        case .notDetermined: return "prompt"
        case .denied, .restricted: return "denied"
        default: return "granted"
        }
    }

    func current() async -> Outcome {
        if let last = manager.location, -last.timestamp.timeIntervalSinceNow < Self.reuseInterval {
            return .located(last)
        }
        return await withCheckedContinuation { continuation in
            waiters.append(continuation)
            guard waiters.count == 1 else { return }
            start()
        }
    }

    private func start() {
        timeoutTask?.cancel()
        timeoutTask = Task { [weak self] in
            try? await Task.sleep(for: Self.timeout)
            guard !Task.isCancelled else { return }
            self?.finish(.failed)
        }
        switch manager.authorizationStatus {
        case .notDetermined:
            awaitingAuthorization = true
            manager.requestWhenInUseAuthorization()
        case .denied, .restricted:
            finish(.denied)
        default:
            manager.requestLocation()
        }
    }

    private func finish(_ outcome: Outcome) {
        timeoutTask?.cancel()
        timeoutTask = nil
        awaitingAuthorization = false
        let pending = waiters
        waiters = []
        for waiter in pending { waiter.resume(returning: outcome) }
    }

    // MARK: CLLocationManagerDelegate

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard awaitingAuthorization, !waiters.isEmpty else { return }
        switch manager.authorizationStatus {
        case .notDetermined:
            return
        case .denied, .restricted:
            finish(.denied)
        default:
            awaitingAuthorization = false
            manager.requestLocation()
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard !waiters.isEmpty, let location = locations.last else { return }
        finish(.located(location))
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        guard !waiters.isEmpty else { return }
        if (error as? CLError)?.code == .denied {
            finish(.denied)
        } else {
            finish(.failed)
        }
    }
}
