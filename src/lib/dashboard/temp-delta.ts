/**
 * 気温の前日比（#665）。天気カードの最高・最低に「(＋3.2)」の形で添える。
 *
 * 純粋なモジュール（`test/temp-delta.test.ts`）。画面に出る値（小数1桁）どうしの差にするので、
 * 「20.1° (＋3.2)」の前日が 16.9° と読めて、足し引きが合う。
 */

export type TempDirection = "up" | "down" | "same";

export type TempDelta = { text: string; direction: TempDirection };

/** 画面と同じ小数1桁へ丸める。 */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * `current` の `previous` に対する差。どちらかが無い・数でない値なら null（差は出さない）。
 * ＋は高い、−（U+2212）は低い、同じなら「±0.0」。
 */
export function tempDelta(current: number | null, previous: number | null): TempDelta | null {
  if (current === null || previous === null) return null;
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  const diff = round1(round1(current) - round1(previous));
  if (diff === 0) return { text: "(±0.0)", direction: "same" };
  const magnitude = Math.abs(diff).toFixed(1);
  return diff > 0
    ? { text: `(＋${magnitude})`, direction: "up" }
    : { text: `(−${magnitude})`, direction: "down" };
}
