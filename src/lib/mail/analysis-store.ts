import { db } from "@/lib/db";

import { parseAnalyzeReply, type MailAnalysis } from "@/lib/mail/analyze-core";
import { createTombstones } from "@/lib/mail/list-summary-core";

/**
 * メールのAI分析の保存（#883）。**サーバー専用。** 受信時の先回り（`analyze.ts` の `prefetchAnalyses()`）と、開いたときの分析の結果を
 * `MailAnalysisResult` に持つ。**#732の例外**（#851の一覧の要約に続く2つ目）。持つのはモデルの返答（要約・提案・引き落とし読み取りのJSON）だけで、
 * 件名・差出人・本文は持たない。削除の契機は ①アーカイブ・ゴミ箱の操作の成功 ②受信トレイにINBOXの無いと分かった行 ③90日経過。
 *
 * 返答の文字列のまま持ち、読むときは `parseAnalyzeReply()` で検証し直す（壊れた行はnull＝作り直し）。
 */

export const ANALYSIS_RETENTION_DAYS = 90;

/** 生成中に消された（アーカイブ・ゴミ箱）メール。保存で行を復活させないための印（#860と同じ仕組み）。 */
const tombstones = createTombstones();

export async function getStoredAnalysis(userId: string, messageId: string): Promise<MailAnalysis | null> {
  const row = await db.mailAnalysisResult.findUnique({
    where: { userId_messageId: { userId, messageId } },
    select: { reply: true },
  });
  return row ? parseAnalyzeReply(row.reply) : null;
}

export async function storedAnalysisIds(userId: string, messageIds: string[]): Promise<Set<string>> {
  if (messageIds.length === 0) return new Set();
  const rows = await db.mailAnalysisResult.findMany({ where: { userId, messageId: { in: messageIds } }, select: { messageId: true } });
  return new Set(rows.map((row) => row.messageId));
}

/** 生成の開始（`startedAt`）より後に削除の印が付いていたら保存しない。保存の後にも見て、競合したら消し直す。 */
export async function saveAnalysis(userId: string, messageId: string, reply: string, startedAt: number): Promise<void> {
  if (tombstones.deletedSince(userId, [messageId], startedAt).length > 0) return;
  await db.mailAnalysisResult.upsert({
    where: { userId_messageId: { userId, messageId } },
    create: { userId, messageId, reply },
    update: { reply, createdAt: new Date() },
  });
  if (tombstones.deletedSince(userId, [messageId], startedAt).length > 0) {
    await db.mailAnalysisResult.deleteMany({ where: { userId, messageId } });
  }
}

export async function deleteAnalyses(userId: string, messageIds: string[]): Promise<void> {
  if (messageIds.length === 0) return;
  // 先に印を付ける（DBの削除より後に付けると、その間の保存が見逃される）
  tombstones.mark(userId, messageIds);
  await db.mailAnalysisResult.deleteMany({ where: { userId, messageId: { in: messageIds } } });
}

/** 期限（90日）を過ぎた行を、全利用者ぶん消す。 */
export async function pruneAnalyses(now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - ANALYSIS_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = await db.mailAnalysisResult.deleteMany({ where: { createdAt: { lt: before } } });
  return result.count;
}
