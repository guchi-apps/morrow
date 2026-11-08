/**
 * ログインせずに開ける経路（middlewareの `updateSession()` が素通しする）。
 *
 * - `/auth/native/*` はiOSアプリの認証シート（Cookie無し）とログイン前のWKWebViewから呼ばれる（#441）
 * - `/api/app-version` は本番デプロイのヘルスチェック（127.0.0.1・Cookie無し）が稼働版のSHAを
 *   照合するために叩く（#567）。返すのはバージョンとコミットSHAだけ
 *
 * DBやSupabaseへ触れないファイルに置き、`test/public-paths.test.ts` から直接確かめる。
 */
export const publicPaths = ["/login", "/auth/signin", "/auth/callback", "/auth/native", "/api/app-version"];

export function isPublicPath(pathname: string): boolean {
  return publicPaths.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
