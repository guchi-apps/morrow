import { HISTORY_MAX_LIMIT, isPathSafeSessionId, type HistoryBody, type HistoryMessage } from "../src/lib/hermes/contract.ts";
import { SESSION_SOURCE } from "./turn.ts";

/**
 * 会話の履歴（#752）。Hermesの REST `GET /api/sessions/{id}` と `/api/sessions/{id}/messages` を読み、
 * **`source` が `morrow` のセッションだけ**を、表示に要る項目に絞って返す。
 *
 * - 認証はヘッダー `X-Hermes-Session-Token`（WebSocketの `?token=` と同じ値。Hermesの `web_server.py` の `_SESSION_HEADER_NAME`）。
 *   応答は `/api/sessions/{id}` が `sessions` テーブルの行（`source`・`title` など）、`/messages` が `{ session_id, messages: 行[], pagination }`。
 *   無いidは404（Hermes v0.22.5・`bf0203a794`。2026-11-08に実物で確認）
 * - WebSocketの `session.resume`＋`session.history` は使わない。読むだけでHermesに生きたセッションを作るため
 * - Hermesの行は許可リストで拾う。`api_content`（モデルへ渡したシステム注記入り）・推論（暗号化された中身を含む）・
 *   道具の引数と結果は返さない（2026-11-08に実物の `morrow` profileで、これらが行に載ることを確認した）
 * - Morrowはこれを受け取って表示するだけで、保存しない（`docs/hermes-actions.md`「実行の記録」）
 */

/** セッションが無い・Morrowのセッションではない（区別せず同じ404）。 */
export class HistoryNotFoundError extends Error {}

export type HistoryReader = (sessionId: string, limit: number) => Promise<HistoryBody>;

/** 1件の本文の上限（`POST /turns` の本文の上限と同じ）。 */
const MAX_MESSAGE_TEXT = 20_000;
/** Hermesの1ページの上限（RESTの `limit` の上限）。 */
const HERMES_PAGE_MAX = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 本文。文字列か、`{type:"text", text}` の並び（画像などは捨てる）。 */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
      .filter((part) => part !== "")
      .join("\n");
  }
  return "";
}

/** `tool_calls`（JSONの文字列か配列）から道具の名前だけを取り出す。 */
function toolNamesOf(toolCalls: unknown): string[] {
  let calls: unknown = toolCalls;
  if (typeof calls === "string") {
    try {
      calls = JSON.parse(calls);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(calls)) return [];
  const names: string[] = [];
  for (const call of calls) {
    if (!isRecord(call)) continue;
    const fn = isRecord(call.function) ? call.function : undefined;
    const name = typeof fn?.name === "string" ? fn.name : typeof call.name === "string" ? call.name : "";
    if (name !== "") names.push(name.slice(0, 200));
  }
  return names;
}

/**
 * Hermesの行（古い順）を表示用に絞る。利用者とHermesの発言だけを残し、道具の結果の行（`role: tool`）・
 * 表示用の特別な行（`display_kind` 付き。圧縮の要約・通知など）・本文も道具も無い行は落とす。直近 `limit` 件を返す。
 */
export function projectHistory(rows: unknown, limit: number): { messages: HistoryMessage[]; truncated: boolean } {
  const kept: HistoryMessage[] = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!isRecord(row)) continue;
    if (row.role !== "user" && row.role !== "assistant") continue;
    if (row.display_kind !== undefined && row.display_kind !== null && row.display_kind !== "") continue;
    const text = textOf(row.content).slice(0, MAX_MESSAGE_TEXT);
    const tools = row.role === "assistant" ? toolNamesOf(row.tool_calls) : [];
    if (text.trim() === "" && tools.length === 0) continue;
    const at = typeof row.timestamp === "number" && Number.isFinite(row.timestamp) ? Math.round(row.timestamp * 1000) : null;
    kept.push({ role: row.role, text, at, ...(tools.length > 0 ? { tools } : {}) });
  }
  return { messages: kept.slice(-limit), truncated: kept.length > limit };
}

/** HermesのRESTを読む本体。`fetchImpl` はテストで差し替える。 */
export function createHistoryReader(options: {
  url: string;
  token: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}): HistoryReader {
  const doFetch = options.fetchImpl ?? fetch;

  async function getJson(path: string): Promise<{ status: number; body: unknown }> {
    const response = await doFetch(new URL(path, options.url), {
      headers: { "x-hermes-session-token": options.token, accept: "application/json" },
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    const body: unknown = await response.json().catch(() => null);
    return { status: response.status, body };
  }

  return async (sessionId, limit) => {
    // パスへ埋め込むので、呼び出し側（server.ts）の検証に頼らずここでも断る
    if (!isPathSafeSessionId(sessionId)) throw new HistoryNotFoundError("セッションidの形が不正");
    const id = encodeURIComponent(sessionId);
    const detail = await getJson(`/api/sessions/${id}`);
    if (detail.status === 404) throw new HistoryNotFoundError("セッションが無い");
    if (detail.status !== 200 || !isRecord(detail.body)) throw new Error(`セッションの取得に失敗した（HTTP ${detail.status}）`);
    // Discordなど、Morrow以外のセッションは「無い」と同じに扱う（中身も有無も見せない）
    if (detail.body.source !== SESSION_SOURCE) throw new HistoryNotFoundError("Morrowのセッションではない");

    // 道具の結果の行などを落とすので、表示する件数より多めに読む
    const pageSize = Math.min(HERMES_PAGE_MAX, Math.max(1, Math.min(limit, HISTORY_MAX_LIMIT)) * 4 + 1);
    const page = await getJson(`/api/sessions/${id}/messages?limit=${pageSize}&order=latest&inline_images=false`);
    if (page.status === 404) throw new HistoryNotFoundError("セッションが無い");
    if (page.status !== 200 || !isRecord(page.body) || !Array.isArray(page.body.messages)) {
      throw new Error(`履歴の取得に失敗した（HTTP ${page.status}）`);
    }
    const { messages, truncated } = projectHistory(page.body.messages, limit);
    const title = typeof detail.body.title === "string" && detail.body.title !== "" ? detail.body.title.slice(0, 200) : null;
    return { sessionId, title, messages, hasMore: truncated || page.body.messages.length >= pageSize };
  };
}
