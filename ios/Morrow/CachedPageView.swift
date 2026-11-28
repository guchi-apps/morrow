import SwiftUI
import WebKit

/// 画面に出している保存済みの内容（#643）
struct CachedPage: Equatable {
    enum Mode {
        /// 接続できない（圏外・サーバー障害）ので保存済みを出している
        case unreachable
        /// 読み込みが遅いので、本物が着くまで先に出している
        case slow
    }

    let key: String
    let html: String
    let savedAt: Date
    let mode: Mode

    static func == (lhs: CachedPage, rhs: CachedPage) -> Bool {
        lhs.key == rhs.key && lhs.savedAt == rhs.savedAt && lhs.mode == rhs.mode
    }
}

/// 保存済みの画面を読み取り専用で出し、下端に状態の小さな表示を浮かせる。リンクは `open` に渡す
/// （保存があればそれを、無ければ通常の読み込みを試す）
///
/// 状態の表示は上に積まない（#1235）。上に置くとWebのヘッダーが押し下げられる
struct CachedPageView: View {
    let page: CachedPage
    let isRetrying: Bool
    let retry: () -> Void
    let open: (URL) -> Void

    /// この幅以上ではWebが下部ナビを出さない（Tailwindの `lg`）
    private static let wideWidth: CGFloat = 1024
    /// 下部ナビ（下の隙間10＋高さ54。`mobile-tab-bar.tsx`）の上に8あける
    private static let aboveTabBar: CGFloat = 72

    var body: some View {
        ZStack {
            CachedWebView(page: page, open: open)
                .ignoresSafeArea(edges: .bottom)

            GeometryReader { geometry in
                status
                    .padding(.horizontal, 16)
                    .padding(.bottom, geometry.size.width >= Self.wideWidth ? 16 : Self.aboveTabBar)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
            }
        }
        .background(Color("HeaderBand"))
    }

    private var status: some View {
        HStack(spacing: 10) {
            if page.mode == .slow {
                ProgressView()
            } else {
                Image(systemName: "wifi.slash").foregroundStyle(.secondary)
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(page.mode == .slow ? "読み込み中" : "接続できません")
                    .font(.footnote.weight(.semibold))
                Text("\(Self.formatted(page.savedAt))の内容を表示")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if page.mode == .unreachable {
                Button(action: retry) {
                    Text(isRetrying ? "読み込み中" : "再読み込み").font(.footnote.weight(.semibold))
                }
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .disabled(isRetrying)
                .padding(.leading, 4)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(Color(.secondarySystemGroupedBackground), in: Capsule())
        .overlay(Capsule().strokeBorder(Color(.separator), lineWidth: 0.5))
        .shadow(color: .black.opacity(0.15), radius: 12, y: 6)
    }

    /// 今日の内容は時刻だけ、それより前は日付も出す
    private static func formatted(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ja_JP")
        formatter.dateFormat = Calendar.current.isDateInToday(date) ? "H:mm" : "M月d日 H:mm"
        return formatter.string(from: date)
    }
}

/// スクリプトを動かさない WKWebView。保存した HTML を、本物と同じオリジンを基準に描く
private struct CachedWebView: UIViewRepresentable {
    let page: CachedPage
    let open: (URL) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(open: open) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = UIColor(named: "HeaderBand")
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.open = open
        // 状態の帯だけが変わった再描画（slow → 取得失敗など）ではスクロール位置を保つ
        let identity = "\(page.key)|\(page.savedAt.timeIntervalSince1970)"
        guard context.coordinator.loaded != identity else { return }
        context.coordinator.loaded = identity
        webView.loadHTMLString(page.html, baseURL: AppConfig.baseURL)
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var open: (URL) -> Void
        var loaded: String?

        init(open: @escaping (URL) -> Void) { self.open = open }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction
        ) async -> WKNavigationActionPolicy {
            guard navigationAction.navigationType == .linkActivated, let url = navigationAction.request.url else {
                return .allow
            }
            await MainActor.run { open(url) }
            return .cancel
        }
    }
}
