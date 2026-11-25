import { SESSION_LIST_MAX_LIMIT, isPathSafeSessionId, type SessionListBody, type SessionSummary } from "../src/lib/hermes/contract.ts";
import { SESSION_SOURCE } from "./turn.ts";

/**
 * 会話の一覧（#1156）。Morrowが渡したセッションid（自分の `HermesSession`）それぞれについて、Hermesの REST
 * `GET /api/sessions/{id}`（履歴〔`history.ts`〕と同じ・実物で確認済みの口）を読み、**`source` が `morrow` の行だけ**を
 * 題名・最終更新・件数に絞って最近動いた順で返す。**本文・先頭の抜粋（`preview`）は返さない**。
 * 「件数で切ってから持ち主で絞る」と他の利用者・持ち主不明の会話が枠を先に使って自分の会話が欠けるため、
 * 持ち主での絞り込みはidを渡す側（Morrow）が先に行い、ここはidの題名等を引くだけ。
 */

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
    // 最終更新（秒）。**`/api/sessions/{id}` の行は `last_active` がnull**（一覧の口〔`/api/sessions`〕だけが埋める。
    // 2026-11-24に実物で確認）。代わりに載る `last_activity_at`・`ended_at`・`started_at` のうち最も新しい値を使う
    const seconds = [row.last_active, row.last_activity_at, row.ended_at, row.started_at].filter(
      (v): v is number => typeof v === "number" && Number.isFinite(v),
    );
    const latest = seconds.length === 0 ? null : Math.max(...seconds);
    out.push({ sessionId: row.id, title, lastActiveAt: latest === null ? null : Math.round(latest * 1000), messageCount: count });
  }
  return out;
}

export type SessionLister = (ids: string[]) => Promise<SessionListBody>;

export function createSessionLister(options: { url: string; token: string; timeoutMs: number; fetchImpl?: typeof fetch }): SessionLister {
  const doFetch = options.fetchImpl ?? fetch;

  async function detail(id: string): Promise<unknown> {
    const response = await doFetch(new URL(`/api/sessions/${encodeURIComponent(id)}`, options.url), {
      headers: { "x-hermes-session-token": options.token, accept: "application/json" },
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    if (response.status === 404) return null; // 消えたセッションは一覧から外れるだけ
    const body: unknown = await response.json().catch(() => null);
    if (response.status !== 200 || !isRecord(body)) throw new Error(`会話の取得に失敗した（HTTP ${response.status}）`);
    return body;
  }

  return async (ids) => {
    const wanted = [...new Set(ids)].filter(isPathSafeSessionId).slice(0, SESSION_LIST_MAX_LIMIT);
    const results = await Promise.allSettled(wanted.map(detail));
    // 全部失敗したときだけ失敗にする（一部が読めなくても、読めた分は出す）
    if (wanted.length > 0 && results.every((r) => r.status === "rejected")) throw new Error("会話の取得に失敗した");
    const rows = results.flatMap((r) => (r.status === "fulfilled" && r.value !== null ? [r.value] : []));
    const sessions = projectSessions(rows).sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0));
    return { sessions };
  };
}
