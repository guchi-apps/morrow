/**
 * HermesがAIDEの道具を読み込めているかの判定（#1158。純粋）。
 *
 * 材料はHermesの `mcp.servers.status`（キャッシュ済みの実行時の状態を返すだけ。接続も認証も始めない。
 * 2026-11-23にsubpcで実測: `aide: connected / tools 33`）。ブリッジの `/health` が使い、Morrowの画面が読む。
 * ブリッジ（素のNode）も読むので、Prismaにも `@/` にも触れない。
 *
 * **接続エラーの文面はブラウザへ渡さない**（URLや内部の語が混ざりうる）。渡すのは下の4状態だけ。
 */

/**
 * - ok: 道具が読み込まれている
 * - connecting: 接続の途中（Hermesの再接続の間。警告にしない）
 * - unavailable: 道具が1本も読み込まれていない（OAuthが切れている・接続に失敗している・無効）
 */
export type AideHealth = "ok" | "connecting" | "unavailable";

export const AIDE_SERVER_NAME = "aide";

export function aideHealthFromStatus(result: unknown): AideHealth | null {
  if (typeof result !== "object" || result === null) return null;
  const servers = (result as { servers?: unknown }).servers;
  if (!Array.isArray(servers)) return null;
  const entry = servers.find(
    (server): server is Record<string, unknown> =>
      typeof server === "object" && server !== null && (server as { name?: unknown }).name === AIDE_SERVER_NAME,
  );
  // 設定に無い・形が読めない回は「分からない」（切れていると断定しない）
  if (!entry) return null;
  const status = typeof entry.status === "string" ? entry.status : "";
  const tools = typeof entry.tools === "number" && Number.isFinite(entry.tools) ? entry.tools : 0;
  // lazy: 登録済みで最初の利用時に起動する。道具は呼べる
  if ((entry.connected === true || status === "connected" || status === "lazy") && tools > 0) return "ok";
  if (status === "connecting") return "connecting";
  return "unavailable";
}

export function isAideHealth(value: unknown): value is AideHealth {
  return value === "ok" || value === "connecting" || value === "unavailable";
}
