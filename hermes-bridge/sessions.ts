import { SESSION_LIST_MAX_LIMIT, isPathSafeSessionId, type SessionListBody, type SessionSummary } from "../src/lib/hermes/contract.ts";
import { SESSION_SOURCE } from "./turn.ts";

/**
 * 会話の一覧（#1156）。Hermesの REST `GET /api/sessions?source=morrow&order=recent` を読み、
 * **`source` が `morrow` の行だけ**を、題名・最終更新・件数に絞って返す。**本文・先頭の抜粋（`preview`）は返さない**。
 * 認証・応答の形の扱いは履歴（`history.ts`）と同じ。持ち主（Morrowの利用者）の絞り込みはMorrow側（`HermesSession`）で行う。
 */

export type SessionLister = (limit: number) => Promise<SessionListBody>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Hermesの行を許可リストで絞る。`source` が違う・idの形が不正・まだ発言の無い行は落とす。 */
export function projectSessions(rows: unknown): SessionSummary[] {
  const out: SessionSummary[] = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!isRecord(row)) continue;
    if (row.source !== SESSION_SOURCE) continue;
    if (typeof row.id !== "string" || !isPathSafeSessionId(row.id)) continue;
    const count = typeof row.message_count === "number" && Number.isFinite(row.message_count) ? Math.max(0, Math.trunc(row.message_count)) : 0;
    if (count === 0) continue;
    const title = typeof row.title === "string" && row.title.trim() !== "" ? row.title.trim().slice(0, 200) : null;
    // `last_active` は秒（無ければ開始時刻）
    const seconds = [row.last_active, row.started_at].find((v): v is number => typeof v === "number" && Number.isFinite(v));
    out.push({ sessionId: row.id, title, lastActiveAt: seconds === undefined ? null : Math.round(seconds * 1000), messageCount: count });
  }
  return out;
}

export function createSessionLister(options: { url: string; token: string; timeoutMs: number; fetchImpl?: typeof fetch }): SessionLister {
  const doFetch = options.fetchImpl ?? fetch;
  return async (limit) => {
    const n = Math.min(SESSION_LIST_MAX_LIMIT, Math.max(1, limit));
    const path = `/api/sessions?source=${encodeURIComponent(SESSION_SOURCE)}&order=recent&min_messages=1&limit=${n}`;
    const response = await doFetch(new URL(path, options.url), {
      headers: { "x-hermes-session-token": options.token, accept: "application/json" },
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    const body: unknown = await response.json().catch(() => null);
    if (response.status !== 200 || !isRecord(body) || !Array.isArray(body.sessions)) {
      throw new Error(`会話一覧の取得に失敗した（HTTP ${response.status}）`);
    }
    return { sessions: projectSessions(body.sessions) };
  };
}
