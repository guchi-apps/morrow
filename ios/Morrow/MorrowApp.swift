import SwiftUI

@main
struct MorrowApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    @StateObject private var model = WebViewModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            // ステータスバーの部分はWebのヘッダーと同じ色で塗る。WebViewはステータスバーの
            // 下から始めるので、スクロールした内容が上端へ潜らない
            Color("HeaderBand").ignoresSafeArea()

            WebViewContainer(webView: model.webView)
                .ignoresSafeArea(edges: .bottom)

            if let page = model.cachedPage {
                CachedPageView(
                    page: page,
                    isRetrying: model.isRetrying,
                    retry: model.retry,
                    open: model.openFromCache
                )
                .transition(.opacity)
            }

            if let failure = model.failure {
                ConnectionErrorView(failure: failure, isRetrying: model.isRetrying, retry: model.retry)
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.2), value: model.failure)
        .animation(.easeOut(duration: 0.2), value: model.cachedPage)
        .onOpenURL { model.openUniversalLink($0) }
        .onAppear { model.startIfNeeded() }
        .onChange(of: scenePhase) { _, phase in
            // 別アプリへ行っているあいだに回線が戻っていることがある
            if phase == .active, model.needsRetry { model.retry() }
            // 開いていた画面を保存する（クライアント側の遷移で開いた画面は読み込み完了を通らない）
            if phase != .active { model.saveSnapshotIfPossible() }
        }
    }
}
