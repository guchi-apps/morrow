/**
 * 文字送りの計算（#838。純粋・クライアントからもimportする）。
 *
 * Codex CLIは本文を完了時にまとめてしか返さない（トークンのストリームが無い）ので、届いた結果を画面側で
 * 順に見せる。長い要約でも待たせないよう、全体の所要時間に上限を置く。
 */

/** 1文字あたりの標準の間隔（ミリ秒）。 */
export const TYPEWRITER_CHAR_MS = 28;
/** 全体の所要時間の上限（ミリ秒）。 */
export const TYPEWRITER_MAX_MS = 1600;

/** 経過時間から、表示する文字数を返す（0〜total）。 */
export function visibleChars(total: number, elapsedMs: number, charMs = TYPEWRITER_CHAR_MS, maxMs = TYPEWRITER_MAX_MS): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  const duration = Math.min(total * charMs, maxMs);
  if (elapsedMs >= duration) return total;
  return Math.floor((total * elapsedMs) / duration);
}

/** 全体の表示文字数を、要約→要点1→要点2…の各部分へ振り分ける。 */
export function splitVisible(parts: readonly string[], shown: number): string[] {
  let rest = Math.max(0, shown);
  return parts.map((part) => {
    const take = Math.min(part.length, rest);
    rest -= take;
    return part.slice(0, take);
  });
}

/** 分析を待っている経過秒の文言。 */
export function elapsedLabel(seconds: number): string {
  return `${Math.max(0, Math.floor(seconds))}秒`;
}
