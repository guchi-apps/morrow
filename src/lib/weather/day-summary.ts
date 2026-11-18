import type { DailyPoint } from "@/lib/weather/rain-check";

/**
 * 天気ページ上部の「表示中の日」の要約（#1078）。純粋関数（クライアントからもimportするのでPrismaなどを持ち込まない）。
 * 昨日比は前日の日別の最高・最低との差。前日が予報に無い（範囲の先頭の日）・値が欠けているときはnull。
 */
export type DaySummary = {
  date: string;
  label: string;
  code: number | null;
  condition: string;
  pop: number | null;
  max: number | null;
  min: number | null;
  maxDiff: number | null;
  minDiff: number | null;
};

/** 前日との差（四捨五入した℃）。どちらかが欠けていればnull。 */
export function diffFromPrevious(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  return Math.round(current) - Math.round(previous);
}

/** 差の表記。「+2°」「−1°」「±0°」。 */
export function formatDiff(diff: number): string {
  if (diff === 0) return "±0°";
  return `${diff > 0 ? "+" : "−"}${Math.abs(diff)}°`;
}

export function summarizeDay(
  daily: DailyPoint | null,
  previous: DailyPoint | null,
  meta: { date: string; label: string; condition: string },
): DaySummary {
  return {
    date: meta.date,
    label: meta.label,
    code: daily?.code ?? null,
    condition: daily ? meta.condition : "予報なし",
    pop: daily?.pop ?? null,
    max: daily?.max ?? null,
    min: daily?.min ?? null,
    maxDiff: diffFromPrevious(daily?.max ?? null, previous?.max ?? null),
    minDiff: diffFromPrevious(daily?.min ?? null, previous?.min ?? null),
  };
}

/** 帯の列の位置（0始まり）→ 日。1日24列で、先頭の列が `days[0]` の0時。範囲外は端へ丸める。 */
export function dayAtColumn(days: string[], column: number): string {
  const index = Math.max(0, Math.min(days.length - 1, Math.floor(column / 24)));
  return days[index];
}
