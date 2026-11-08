/** メール一覧のスワイプでアーカイブ（#715）の判定。DOMに触れない純粋な関数。 */

/** 向きを決めるまでの動き（px）。 */
export const LOCK_PX = 10;
/** 画面の左右の端から始めた操作を無視する幅（iOSの戻る・進むと食い合わせない）。 */
export const EDGE_PX = 24;
const THRESHOLD_RATIO = 0.35;
const THRESHOLD_MIN_PX = 80;

/** 最初の動きから向きを決める。動きが足りなければnull。 */
export function lockDirection(dx: number, dy: number): "h" | "v" | null {
  if (Math.abs(dx) < LOCK_PX && Math.abs(dy) < LOCK_PX) return null;
  return Math.abs(dx) > Math.abs(dy) ? "h" : "v";
}

/** アーカイブとみなす距離。 */
export function archiveThreshold(rowWidth: number): number {
  return Math.max(THRESHOLD_MIN_PX, rowWidth * THRESHOLD_RATIO);
}

/** 左へ引いた分だけ追従する（右へは動かさない）。値は0以下。 */
export function followOffset(dx: number): number {
  return Math.min(0, dx);
}

export function isArchiveRelease(offset: number, rowWidth: number): boolean {
  return -offset >= archiveThreshold(rowWidth);
}

/** 画面の左右の端から始めた操作か。 */
export function startsAtScreenEdge(x: number, screenWidth: number): boolean {
  return x < EDGE_PX || x > screenWidth - EDGE_PX;
}
