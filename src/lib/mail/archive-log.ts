import { db } from "@/lib/db";
import { ARCHIVE_VIEW_LIMIT, archiveCutoff, type ArchiveEntry } from "@/lib/mail/archive-log-core";

/**
 * 最近のアーカイブの控え（#1122）。持つのはメッセージIDと時刻だけ（件名・差出人・本文は持たない）。
 * 失敗しても本筋（アーカイブそのもの）は止めないので、呼ぶ側は `.catch()` でログに落とす。
 */

/** アーカイブに成功したメールを記録する。もう一度アーカイブした分は時刻を更新する。 */
export async function recordArchived(userId: string, messageIds: string[], now = new Date()): Promise<void> {
  const ids = [...new Set(messageIds)];
  if (ids.length === 0) return;
  await db.$transaction(
    ids.map((messageId) =>
      db.mailArchiveLog.upsert({
        where: { userId_messageId: { userId, messageId } },
        create: { userId, messageId, archivedAt: now },
        update: { archivedAt: now },
      }),
    ),
  );
}

/** 受信トレイへ戻した・ゴミ箱へ移したメールの控えを消す。 */
export async function forgetArchivedLog(userId: string, messageIds: string[]): Promise<void> {
  if (messageIds.length === 0) return;
  await db.mailArchiveLog.deleteMany({ where: { userId, messageId: { in: messageIds } } });
}

/** 直近の控えを新しい順に返す。 */
export async function recentArchived(userId: string, now = new Date()): Promise<ArchiveEntry[]> {
  const rows = await db.mailArchiveLog.findMany({
    where: { userId, archivedAt: { gte: archiveCutoff(now) } },
    orderBy: { archivedAt: "desc" },
    take: ARCHIVE_VIEW_LIMIT,
    select: { messageId: true, archivedAt: true },
  });
  return rows.map((row) => ({ messageId: row.messageId, archivedAt: row.archivedAt.getTime() }));
}

/** 期間を過ぎた控えを掃除する（cron）。 */
export async function pruneArchiveLog(now = new Date()): Promise<number> {
  const result = await db.mailArchiveLog.deleteMany({ where: { archivedAt: { lt: archiveCutoff(now) } } });
  return result.count;
}
