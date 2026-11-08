import { db } from "@/lib/db";

import { contentKeyOf, summarizeSuggestion, type FlowRecordStatus } from "@/lib/mail/flow-record-core";
import type { Suggestion } from "@/lib/mail/suggest-core";

/**
 * メールから登録した内容の控え（#750）。**サーバー専用**（Prismaを引く）。
 * 保存に失敗しても本筋（登録そのもの）は止めない。
 */

export type FlowRecordRow = { kind: string; summary: string; status: string; createdAt: Date };

export async function saveFlowRecord(userId: string, messageId: string, suggestion: Suggestion, status: FlowRecordStatus): Promise<void> {
  try {
    const summary = summarizeSuggestion(suggestion);
    const contentKey = contentKeyOf(summary);
    await db.mailFlowRecord.upsert({
      where: { userId_messageId_kind_contentKey: { userId, messageId, kind: suggestion.kind, contentKey } },
      create: { userId, messageId, kind: suggestion.kind, summary, status, contentKey },
      // 重複と判定された再実行で、最初の「登録済み」を上書きしない。開いただけ→登録済みの順は上書きしない
      update: status === "done" || status === "pending" ? { status } : {},
    });
  } catch (error) {
    console.error("[aide-bot] メールの登録記録の保存に失敗した", error instanceof Error ? error.message : error);
  }
}

export async function flowRecordsFor(userId: string, messageId: string): Promise<FlowRecordRow[]> {
  try {
    return await db.mailFlowRecord.findMany({
      where: { userId, messageId },
      orderBy: { createdAt: "asc" },
      select: { kind: true, summary: true, status: true, createdAt: true },
    });
  } catch {
    return [];
  }
}

/** 一覧の行に出すチップ用。メールIDごとの種類（重複なし）。 */
export async function flowKindsFor(userId: string, messageIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (messageIds.length === 0) return map;
  try {
    const rows = await db.mailFlowRecord.findMany({
      where: { userId, messageId: { in: messageIds } },
      orderBy: { createdAt: "asc" },
      select: { messageId: true, kind: true },
    });
    for (const row of rows) {
      const kinds = map.get(row.messageId) ?? [];
      if (!kinds.includes(row.kind)) kinds.push(row.kind);
      map.set(row.messageId, kinds);
    }
  } catch {
    // 控えが読めなくても一覧は出す
  }
  return map;
}
