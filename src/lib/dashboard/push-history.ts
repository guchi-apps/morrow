import { dayLabel, jstDayKey } from "@/lib/day-key";

/**
 * 「届いた通知」（`/pushes`。#581）を日付ごとに割る。**Prismaに触れない純粋な関数**（`test/push-history.test.ts`）。
 *
 * #574で過去の日の画面（`/d/<日付>`）と左メニューの日付一覧が無くなり、ダッシュボードは今日の分しか出さない。
 * 端末に残っている前日以前の通知（`/` や古い `/c/<ID>` を開く）から本文へ辿れるよう、日をまたいで並べる受け皿。
 */

/** 遡って出す件数の上限。`NotificationLog` は消していないので、期間ではなく件数で切る。 */
export const PUSH_HISTORY_LIMIT = 200;

export type PushDay<T> = { dayKey: string; label: string; pushes: T[] };

/**
 * 新しい順に並んだ行を、日本時間の日付ごとにまとめる。日付は新しい順、同じ日の中はダッシュボードの
 * 「今日届いた通知」と同じ古い順（朝の見通し→急ぎ→…と1日の流れで読める）。
 */
export function groupPushesByDay<T extends { createdAt: Date }>(rows: T[]): PushDay<T>[] {
  const days: PushDay<T>[] = [];
  for (const row of rows) {
    const dayKey = jstDayKey(row.createdAt);
    let day = days.find((entry) => entry.dayKey === dayKey);
    if (!day) {
      day = { dayKey, label: dayLabel(dayKey), pushes: [] };
      days.push(day);
    }
    day.pushes.push(row);
  }
  days.sort((a, b) => (a.dayKey < b.dayKey ? 1 : a.dayKey > b.dayKey ? -1 : 0));
  for (const day of days) {
    day.pushes.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }
  return days;
}
