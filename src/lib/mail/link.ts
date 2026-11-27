import { db } from "@/lib/db";
import { callToolJson, connectedServerFor, McpCallError } from "@/lib/mcp/direct-call";
import type { ConnectedServer } from "@/lib/mcp/connections";
import { MISSING_SCOPE_REASON } from "@/lib/mcp/tool-error";

import {
  parseEventCandidates,
  mergeTaskCandidates,
  nextTaskCursor,
  linkKey,
  type LinkCandidate,
  type LinkKind,
  type LinkSource,
  type LinkTarget,
  type LinkView,
} from "@/lib/mail/link-core";

/**
 * メールと予定・タスクの紐づけ（#834）。**サーバー専用**（Prismaを引く）。
 * 紐づけは押した操作の控えで、台帳の複製の正ではない。保存・取得の失敗は本筋（メール・予定の表示）を止めない。
 * 持ち主の照合（メールが本人のものか）は呼び出し側が `getMail()` で済ませる。
 */

const SELECT = { id: true, messageId: true, kind: true, targetId: true, calendarId: true, title: true, dateText: true, source: true } as const;

function view(row: { id: string; messageId: string; kind: string; targetId: string; calendarId: string | null; title: string; dateText: string | null; source: string }): LinkView {
  return {
    id: row.id,
    messageId: row.messageId,
    kind: row.kind === "task" ? "task" : "event",
    targetId: row.targetId,
    calendarId: row.calendarId,
    title: row.title,
    dateText: row.dateText,
    source: row.source === "created" ? "created" : "manual",
  };
}

/** 紐づけを保存する。すでにあれば何もしない（最初の `source` を残す）。保存できたらtrue。 */
export async function addMailLink(userId: string, messageId: string, target: LinkTarget, source: LinkSource): Promise<boolean> {
  try {
    await db.mailLink.upsert({
      where: { userId_messageId_kind_targetId: { userId, messageId, kind: target.kind, targetId: target.targetId } },
      create: { userId, messageId, kind: target.kind, targetId: target.targetId, calendarId: target.calendarId, title: target.title, dateText: target.dateText, source },
      update: {},
    });
    return true;
  } catch (error) {
    console.error("[aide-bot] メールの紐づけの保存に失敗した", error instanceof Error ? error.message : error);
    return false;
  }
}

/** 紐づけを外す。自分の行だけ。外せたらtrue。 */
export async function removeMailLink(userId: string, id: string): Promise<boolean> {
  try {
    const result = await db.mailLink.deleteMany({ where: { id, userId } });
    return result.count > 0;
  } catch (error) {
    console.error("[aide-bot] メールの紐づけの解除に失敗した", error instanceof Error ? error.message : error);
    return false;
  }
}

export async function linksForMessage(userId: string, messageId: string): Promise<LinkView[]> {
  try {
    const rows = await db.mailLink.findMany({ where: { userId, messageId }, orderBy: { createdAt: "asc" }, select: SELECT });
    return rows.map(view);
  } catch {
    return [];
  }
}

/** ダッシュボードの行に✉を付けるための逆引き。鍵は `linkKey(kind, targetId)`、値はそのメールのid（新しい順）。 */
export async function mailIdsByTarget(userId: string, targets: { kind: LinkKind; targetId: string }[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (targets.length === 0) return map;
  try {
    const rows = await db.mailLink.findMany({
      where: { userId, OR: targets.map((t) => ({ kind: t.kind, targetId: t.targetId })) },
      orderBy: { createdAt: "desc" },
      select: { messageId: true, kind: true, targetId: true },
    });
    for (const row of rows) {
      const key = linkKey(row.kind === "task" ? "task" : "event", row.targetId);
      map.set(key, [...(map.get(key) ?? []), row.messageId]);
    }
  } catch {
    // 紐づけが読めなくても予定は出す
  }
  return map;
}

/**
 * 候補の取得に失敗したときの画面の文。接続の権限（scope）不足は待っても直らないので、
 * 「時間をおいて」ではなく繋ぎ直しを案内する（#922）。
 */
function failureMessage(error: unknown, fallback: string): string {
  if (error instanceof McpCallError && error.reason === MISSING_SCOPE_REASON) return `${MISSING_SCOPE_REASON}。`;
  return fallback;
}

export type CandidateResult = { ok: true; items: LinkCandidate[] } | { ok: false; kind: "unconfigured" | "failed"; message: string };

/** 予定の候補: 今日の前後（-7〜+6日）。 */
export async function eventCandidates(userId: string): Promise<CandidateResult> {
  const server = await connectedServerFor(userId, "aide");
  if (!server) return { ok: false, kind: "unconfigured", message: "AIDEが接続されていません。設定の接続から繋いでください。" };
  try {
    const json = await callToolJson(server, "aide_schedule", { offsetDays: -7, days: 14 });
    if (json.configured === false || json.complete === false) {
      return { ok: false, kind: "failed", message: "予定を取得できませんでした（一部が読めません）。時間をおいて試してください。" };
    }
    return { ok: true, items: parseEventCandidates(json) };
  } catch (error) {
    console.error("[aide-bot] 紐づけ候補（予定）の取得に失敗した", error instanceof Error ? error.message : error);
    return { ok: false, kind: "failed", message: failureMessage(error, "予定を取得できませんでした。時間をおいて試してください。") };
  }
}

/**
 * `aide_tasks` は `dateField` を省くと期限のあるタスクしか返さない（YoteiFlowの既定が `due`。#1211）ので、3通りを取って合わせる。
 * また1ページは絞り込み前の件数なので、続き（`hasMore`）を辿る（上限つき）。
 */
const TASK_DATE_FIELDS = ["due", "planned", "none"] as const;
const TASK_PAGE_MAX = 5;

async function openTaskPages(server: ConnectedServer, dateField: (typeof TASK_DATE_FIELDS)[number]): Promise<unknown[]> {
  const pages: unknown[] = [];
  let cursor: string | null = null;
  do {
    const json: Record<string, unknown> = await callToolJson(server, "aide_tasks", { status: "open", dateField, limit: 100, ...(cursor ? { cursor } : {}) });
    // 道具の失敗（`ok: false`）を「0件」と混ぜない
    if (json.ok === false) throw new McpCallError("aide_tasks が失敗を返しました");
    pages.push(json);
    cursor = nextTaskCursor(json);
  } while (cursor && pages.length < TASK_PAGE_MAX);
  return pages;
}

/**
 * 未完了のタスクを `dateField` 3通り（期限あり・予定日だけ・どちらも無し）で取り、応答を並べて返す。
 * 同じタスクが複数の応答に出うるので、使う側でidで1件にまとめる。チャットの今日の状態（#1212）も同じ取り方を使う。
 */
export async function fetchOpenTaskResponses(server: ConnectedServer): Promise<unknown[]> {
  const pages = await Promise.all(TASK_DATE_FIELDS.map((dateField) => openTaskPages(server, dateField)));
  return pages.flat();
}

/** タスクの候補: 未完了のもの。 */
export async function taskCandidates(userId: string): Promise<CandidateResult> {
  const server = await connectedServerFor(userId, "aide");
  if (!server) return { ok: false, kind: "unconfigured", message: "AIDEが接続されていません。設定の接続から繋いでください。" };
  try {
    return { ok: true, items: mergeTaskCandidates(await fetchOpenTaskResponses(server)) };
  } catch (error) {
    console.error("[aide-bot] 紐づけ候補（タスク）の取得に失敗した", error instanceof Error ? error.message : error);
    return { ok: false, kind: "failed", message: failureMessage(error, "タスクを取得できませんでした。時間をおいて試してください。") };
  }
}
