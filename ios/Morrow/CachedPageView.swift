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

/// 保存済みの画面を読み取り専用で出し、上に状態の帯を付ける。リンクは `open` に渡す
/// （保存があればそれを、無ければ通常の読み込みを試す）
struct CachedPageView: View {
    let page: CachedPage
    let isRetrying: Bool
    let retry: () -> Void
    let open: (URL) -> Void

    var body: some View {
        VStack(spacing: 0) {
            banner
            CachedWebView(page: page, open: open)
                .ignoresSafeArea(edges: .bottom)
        }
        .background(Color("HeaderBand"))
    }

    private var banner: some View {
        HStack(spacing: 10) {
            if page.mode == .slow {
                ProgressView()
            } else {
                Image(systemName: "wifi.slash").foregroundStyle(.secondary)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(page.mode == .slow ? "読み込み中・保存した内容を表示しています" : "接続できないため、保存した内容を表示しています")
                    .font(.footnote.weight(.semibold))
                Text("最終更新 \(Self.formatted(page.savedAt))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if page.mode == .unreachable {
                Button(action: retry) {
                    Text(isRetrying ? "読み込み中" : "再読み込み").font(.footnote.weight(.semibold))
                }
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .disabled(isRetrying)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity)
        .background(Color("HeaderBand"))
    }

    private static let formatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ja_JP")
        formatter.dateFormat = "M月d日 H:mm"
        return formatter
    }()

    private static func formatted(_ date: Date) -> String {
        formatter.string(from: date)
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
