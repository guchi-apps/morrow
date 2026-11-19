import { tempDelta } from "@/lib/dashboard/temp-delta";
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
  /** 前日比の表記（天気カードと同じ `tempDelta()`。「(＋3.2)」）。出せなければnull */
  maxDiff: string | null;
  minDiff: string | null;
};

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
    maxDiff: tempDelta(daily?.max ?? null, previous?.max ?? null)?.text ?? null,
    minDiff: tempDelta(daily?.min ?? null, previous?.min ?? null)?.text ?? null,
  };
}

/** 帯の列の位置（0始まり）→ 日。1日24列で、先頭の列が `days[0]` の0時。範囲外は端へ丸める。 */
export function dayAtColumn(days: string[], column: number): string {
  const index = Math.max(0, Math.min(days.length - 1, Math.floor(column / 24)));
  return days[index];
}

export type ConditionPart = { text: string; small: boolean };

/**
 * 天気の文字を、強弱をつけて描くための断片に分ける（#1108）。
 * 「晴れ時々くもり」は「時々くもり」全体を、「晴れのちくもり」は「のち」だけを小さくする（前後は同じ重要度）。
 */
export function splitCondition(text: string): ConditionPart[] {
  const sometimes = text.indexOf("時々");
  if (sometimes > 0) return [{ text: text.slice(0, sometimes), small: false }, { text: text.slice(sometimes), small: true }];
  const then = text.indexOf("のち");
  if (then > 0) {
    const parts: ConditionPart[] = [
      { text: text.slice(0, then), small: false },
      { text: "のち", small: true },
    ];
    const rest = text.slice(then + 2);
    if (rest) parts.push({ text: rest, small: false });
    return parts;
  }
  return [{ text, small: false }];
}
