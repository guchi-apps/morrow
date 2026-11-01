/**
 * 気温の昨日との比較（#651）。純粋関数（クライアントからもimportするのでPrismaなどを持ち込まない）。
 * `nowIndex` が範囲内ならその時間の差、無ければ（今日以外の日）昨日と並べられる時間の平均の差。
 */
export type TemperatureDiff = { kind: "same" | "warmer" | "colder"; degrees: number };

/** この差（℃）以内は「同じくらい」。 */
export const SAME_WITHIN = 1;

export function compareWithYesterday(
  cells: { temperature: number | null; yesterday: number | null }[],
  nowIndex: number,
): TemperatureDiff | null {
  const pairs = cells.flatMap((cell, index) =>
    cell.temperature !== null && cell.yesterday !== null ? [{ index, diff: cell.temperature - cell.yesterday }] : [],
  );
  if (pairs.length === 0) return null;
  const atNow = pairs.find((pair) => pair.index === nowIndex);
  const diff = atNow ? atNow.diff : pairs.reduce((sum, pair) => sum + pair.diff, 0) / pairs.length;
  const degrees = Math.round(Math.abs(diff));
  if (Math.abs(diff) <= SAME_WITHIN || degrees === 0) return { kind: "same", degrees: 0 };
  return { kind: diff > 0 ? "warmer" : "colder", degrees };
}

export function describeDiff(diff: TemperatureDiff, isNow: boolean): string {
  const when = isNow ? "いま" : "1日の平均で";
  if (diff.kind === "same") return `${when}昨日と同じくらい`;
  return `${when}昨日より ${diff.degrees}° ${diff.kind === "warmer" ? "暑い" : "寒い"}`;
}
