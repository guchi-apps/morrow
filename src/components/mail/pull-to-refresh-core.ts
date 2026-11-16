/** 引っ張って更新（#1015）の計算。DOMに触れない純粋な関数。 */

/** 表示量がこの距離（px。指の移動量ではその2倍）以上で離すと更新する。 */
export const PULL_THRESHOLD = 48;
/** 引ける最大の表示量（px）。 */
export const PULL_MAX = 96;

/** 指の移動量に抵抗をかけた表示量。0以下は0、上限は PULL_MAX。 */
export function pullDistance(deltaY: number): number {
  if (!(deltaY > 0)) return 0;
  return Math.min(PULL_MAX, deltaY * 0.5);
}

/** 離したときに更新を走らせるか。 */
export function shouldRefresh(distance: number): boolean {
  return distance >= PULL_THRESHOLD;
}

/**
 * 引きを受けつけるか。先頭（scrollTop が0）から始めた、縦に十分傾いた下向きの動きだけ。
 * 横が優位なら（横スクロール・端スワイプ）取り消す。
 */
export function isPullGesture(scrollTop: number, dx: number, dy: number): boolean {
  return scrollTop <= 0 && dy > 0 && Math.abs(dy) > Math.abs(dx) * 1.2;
}
