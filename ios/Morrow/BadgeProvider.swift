import UserNotifications
import WebKit

/// アプリアイコンのバッジを件数にする口（#1144）。WKWebViewには Badging API（`navigator.setAppBadge`）が無いため、
/// 殻が `UNUserNotificationCenter.setBadgeCount` で設定する。通知の許可（`.badge`。`PushRegistration.swift`）が前提で、無ければOSが表示しない。
///
/// Webからは `window.webkit.messageHandlers.morrowBadge.postMessage({ count })` で呼ぶ（`src/lib/app-badge.ts`。
/// 名前・形を変えるときは両方を揃える）。`count` は0以上の整数で、0はバッジを消す。Morrow自身のオリジンのメインフレームだけに答える。
final class BadgeBridge: NSObject, WKScriptMessageHandlerWithReply {
    static let handlerName = "morrowBadge"

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) async -> (Any?, String?) {
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame,
              origin.protocol == AppConfig.baseURL.scheme,
              origin.host == AppConfig.baseURL.host,
              let body = message.body as? [String: Any],
              let number = body["count"] as? NSNumber
        else { return (["status": "rejected"], nil) }

        let count = min(max(number.intValue, 0), 9999)
        do {
            try await UNUserNotificationCenter.current().setBadgeCount(count)
            return (["status": "ok"], nil)
        } catch {
            return (["status": "failed"], nil)
        }
    }
}
