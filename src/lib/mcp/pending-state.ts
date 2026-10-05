/** 認可を始めてからコールバックで受け付ける最大の時間（#469）。 */
export const PENDING_STATE_TTL_MS = 10 * 60 * 1000;

/**
 * 認可の途中経過（state）がまだ使えるか。開始時刻が無い行（列を足す前に始めたもの）は期限切れ扱い。
 * 放置された行の `pendingState` が、いつまでも有効な合言葉として残らないようにする。
 */
export function isPendingStateFresh(startedAt: Date | null, now: number = Date.now()): boolean {
  if (!startedAt) return false;
  const age = now - startedAt.getTime();
  return age >= 0 && age <= PENDING_STATE_TTL_MS;
}
