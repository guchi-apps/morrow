import { db } from "@/lib/db";
import { callToolJson, connectedServerFor } from "@/lib/mcp/direct-call";

import {
  parseEventCandidates,
  parseTaskCandidates,
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
    return { ok: false, kind: "failed", message: "予定を取得できませんでした。時間をおいて試してください。" };
  }
}

/** タスクの候補: 未完了のもの。 */
export async function taskCandidates(userId: string): Promise<CandidateResult> {
  const server = await connectedServerFor(userId, "aide");
  if (!server) return { ok: false, kind: "unconfigured", message: "AIDEが接続されていません。設定の接続から繋いでください。" };
  try {
    const json = await callToolJson(server, "aide_tasks", { status: "open", limit: 60 });
    return { ok: true, items: parseTaskCandidates(json) };
  } catch (error) {
    console.error("[aide-bot] 紐づけ候補（タスク）の取得に失敗した", error instanceof Error ? error.message : error);
    return { ok: false, kind: "failed", message: "タスクを取得できませんでした。時間をおいて試してください。" };
  }
}
