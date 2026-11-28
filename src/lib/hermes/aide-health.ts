/**
 * HermesがAIDEの道具を読み込めているかの判定（#1158・#1240。純粋）。
 *
 * 材料は2つ。
 * - Hermesの `mcp.servers.status`（キャッシュ済みの実行時の状態を返すだけ。接続も認証も始めない。
 *   2026-11-23にsubpcで実測: `aide: connected / tools 33`）
 * - `ok` と言えないときだけブリッジが呼ぶ `mcp.servers.test`（実際に繋いで道具の一覧を取り、切る。
 *   2026-11-28に実測: `{ok: true, tools: [...79件], oauth_needed: true, oauth_tokens_present: true}`。約0.6秒）
 *
 * **`configured`（このプロセスでまだ繋いでいない）だけでは切れていると言えない**（#1240）。Hermesは使われていない間に
 * MCPの接続を畳み、次の利用で張り直す。2026-11-28 21:55（JST）は `/health` が読んだ0.3秒後に35本を登録していたのに、
 * 「読み込まれていません」と出ていた。そのため `ok`・`connecting` 以外は `mcp.servers.test` で確かめてから決める。
 *
 * ブリッジ（素のNode）も読むので、Prismaにも `@/` にも触れない。
 * **接続エラーの文面はブラウザへ渡さない**（URLや内部の語が混ざりうる）。渡すのは下の4状態だけ。
 */

/**
 * - ok: 道具が読み込まれている（または、繋げば読み込める）
 * - connecting: 接続の途中（Hermesの再接続の間。警告にしない）
 * - login_required: AIDEへのログイン（OAuth）が要る（トークンが無い・断られた）
 * - unavailable: それ以外の理由で繋がらない（AIDEが落ちている・無効など）
 */
export type AideHealth = "ok" | "connecting" | "login_required" | "unavailable";

export const AIDE_SERVER_NAME = "aide";

/**
 * `mcp.servers.status` の読み取り。`suspect` は「確かめないと分からない」（`mcp.servers.test` へ回す）。
 * 設定に aide の行が無い・形が読めない回は null（切れていると断定しない）。
 */
export type AideStatusRead = "ok" | "connecting" | "disabled" | "suspect";

export function readAideStatus(result: unknown): AideStatusRead | null {
  if (typeof result !== "object" || result === null) return null;
  const servers = (result as { servers?: unknown }).servers;
  if (!Array.isArray(servers)) return null;
  const entry = servers.find(
    (server): server is Record<string, unknown> =>
      typeof server === "object" && server !== null && (server as { name?: unknown }).name === AIDE_SERVER_NAME,
  );
  if (!entry) return null;
  const status = typeof entry.status === "string" ? entry.status : "";
  const tools = typeof entry.tools === "number" && Number.isFinite(entry.tools) ? entry.tools : 0;
  // lazy: 登録済みで最初の利用時に起動する。道具は呼べる
  if ((entry.connected === true || status === "connected" || status === "lazy") && tools > 0) return "ok";
  if (status === "connecting") return "connecting";
  if (status === "disabled" || entry.disabled === true) return "disabled";
  return "suspect";
}

/** `mcp.servers.test` の結果のうち、判定に使う項目だけ。 */
export interface AideProbe {
  ok: boolean;
  tools: number;
  oauthNeeded: boolean;
  /** トークンのファイルがあるか。Hermesが返さなければ null。 */
  tokensPresent: boolean | null;
  /** 失敗の文面が認証の失敗を示すか（文面そのものは持ち回さない）。 */
  authError: boolean;
}

const AUTH_ERROR_PATTERN = /\b401\b|\b403\b|unauthori[sz]ed|invalid_grant|invalid_token|invalid_client|no cached tokens|oauth|token/i;

export function parseAideProbe(result: unknown): AideProbe | null {
  if (typeof result !== "object" || result === null) return null;
  const r = result as Record<string, unknown>;
  if (typeof r.ok !== "boolean") return null;
  return {
    ok: r.ok,
    tools: Array.isArray(r.tools) ? r.tools.length : 0,
    oauthNeeded: r.oauth_needed === true,
    tokensPresent: typeof r.oauth_tokens_present === "boolean" ? r.oauth_tokens_present : null,
    authError: typeof r.error === "string" && AUTH_ERROR_PATTERN.test(r.error),
  };
}

/**
 * 状態と（呼んだなら）確かめた結果から決める。`probe` が null＝確かめられなかった回は、
 * `suspect` を切れていると断定せず null（何も出さない）にする。
 */
export function aideHealthFrom(read: AideStatusRead | null, probe: AideProbe | null): AideHealth | null {
  if (read === null) return null;
  if (read === "ok" || read === "connecting") return read;
  if (read === "disabled") return "unavailable";
  if (!probe) return null;
  if (probe.ok && probe.tools > 0) return "ok";
  if (probe.oauthNeeded && (probe.tokensPresent === false || probe.authError)) return "login_required";
  return "unavailable";
}

export function isAideHealth(value: unknown): value is AideHealth {
  return value === "ok" || value === "connecting" || value === "login_required" || value === "unavailable";
}

/**
 * 「AIDEに再ログイン」で利用者が貼り付ける、ログイン後に移った先のURL（Hermesの戻り先。ループバックの `/callback`）。
 * 開けないページなので、利用者はアドレス欄のURLをそのまま貼る。**code・stateはログに出さない。**
 * 形の合わない値（別のホスト・パス、code も error も無い）は null。
 */
export interface AideCallback {
  code: string | null;
  state: string;
  error: string | null;
  iss: string | null;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const CALLBACK_PARAM_MAX = 2048;

export function parseAideCallbackUrl(raw: string): AideCallback | null {
  const text = raw.trim();
  if (text === "" || text.length > 8192) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname) || url.pathname.replace(/\/+$/, "") !== "/callback") return null;
  const pick = (name: string): string | null => {
    const value = url.searchParams.get(name);
    return value && value.length <= CALLBACK_PARAM_MAX ? value : null;
  };
  const state = pick("state");
  const code = pick("code");
  const error = pick("error");
  if (!state || (!code && !error)) return null;
  return { code, state, error, iss: pick("iss") };
}

/** ブリッジが「AIDEに再ログイン」で返す認可URL。https 以外は開かせない。 */
export function isSafeAuthUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 8192) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** Hermesの戻り先として使う、登録済みのループバックURL（`mcp-tokens/aide.client.json` の `redirect_uris`）。 */
export function registeredLoopbackRedirect(clientInfo: unknown): string | null {
  if (typeof clientInfo !== "object" || clientInfo === null) return null;
  const uris = (clientInfo as { redirect_uris?: unknown }).redirect_uris;
  if (!Array.isArray(uris)) return null;
  for (const raw of uris) {
    if (typeof raw !== "string") continue;
    try {
      const url = new URL(raw);
      if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname) && url.port !== "" && url.pathname === "/callback") return raw;
    } catch {
      // 読めない行は飛ばす
    }
  }
  return null;
}

/** 再ログインの流れのid（Hermesの `mcp.servers.oauth.start` の `session_id`。`token_urlsafe(24)`）。 */
export const AIDE_LOGIN_FLOW_ID_PATTERN = /^[\w-]{16,64}$/;
