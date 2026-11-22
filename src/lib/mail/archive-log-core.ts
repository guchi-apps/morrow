/**
 * 最近のアーカイブ（#1122）の純粋な部分。Gmail/AIDEにアーカイブ日時は無いので、Morrowで押した操作の控え
 * （メッセージIDと時刻だけ）から、新しい順の並びと日ごとの区切りを作る。
 */

/** 控えを持つ日数（これを過ぎたら掃除する）。 */
export const ARCHIVE_LOG_DAYS = 7;
/** 画面に出す最大件数（1通ずつ本文をAIDEから取るため絞る）。 */
export const ARCHIVE_VIEW_LIMIT = 30;

export type ArchiveEntry = { messageId: string; archivedAt: number };

const dayFormat = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" });
const mdParts = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" });
/** 「11月22日」。ロケールの区切り（11/22）に依らないよう部品から組む。 */
const mdFormat = {
  format(date: Date): string {
    const parts = mdParts.formatToParts(date);
    const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
    return `${pick("month")}月${pick("day")}日`;
  },
};
const DAY_MS = 24 * 60 * 60 * 1000;

/** 日本時間の日付の見出し。今日・昨日はそう書き、それ以前は「11月21日」。 */
export function archiveDayLabel(at: number, now: Date): string {
  const today = dayFormat.format(now);
  const day = dayFormat.format(new Date(at));
  if (day === today) return "今日";
  if (dayFormat.format(new Date(at + DAY_MS)) === today) return `昨日（${mdFormat.format(new Date(at))}）`;
  return mdFormat.format(new Date(at));
}

/** 新しい順に並べ、同じ日（日本時間）ごとにまとめる。 */
export function groupArchiveByDay<T extends { archivedAt: number }>(entries: T[], now: Date): { label: string; items: T[] }[] {
  const sorted = [...entries].sort((a, b) => b.archivedAt - a.archivedAt);
  const groups: { label: string; day: string; items: T[] }[] = [];
  for (const entry of sorted) {
    const day = dayFormat.format(new Date(entry.archivedAt));
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(entry);
    else groups.push({ label: archiveDayLabel(entry.archivedAt, now), day, items: [entry] });
  }
  return groups.map(({ label, items }) => ({ label, items }));
}

/** 控えを持つ期間の起点（これより古い控えは出さない・掃除する）。 */
export function archiveCutoff(now: Date): Date {
  return new Date(now.getTime() - ARCHIVE_LOG_DAYS * DAY_MS);
}
