/**
 * ダッシュボードで表示する日（#606）。`/?d=YYYY-MM-DD` で前後の日へめくる。
 *
 * 純粋なモジュール（クライアントからもimportする。`test/day-offset.test.ts`）。日付の鍵は日本時間の
 * `jstDayKey()` と同じ形で、ここでは暦の足し引きだけをUTCで行う（タイムゾーンに依らない）。
 */

/** 今日から前後にめくれる日数。予定（`aide_schedule` の `offsetDays`）・予報（Open-Meteoの前後）もこの幅で取る。 */
export const DAY_RANGE = 7;

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function utcOf(dayKey: string): number | null {
  if (!DAY_KEY.test(dayKey)) return null;
  const time = Date.parse(`${dayKey}T00:00:00Z`);
  // `2026-02-30` のような実在しない日はDateが繰り上げるので、書き戻して一致するかで落とす。
  if (Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== dayKey) return null;
  return time;
}

/** `dayKey` に `days` 日を足した鍵。読めない鍵なら空文字。 */
export function addDays(dayKey: string, days: number): string {
  const time = utcOf(dayKey);
  return time === null ? "" : new Date(time + days * DAY_MS).toISOString().slice(0, 10);
}

/** `to` が `from` から何日後か。どちらかが読めなければnull。 */
export function dayDiff(from: string, to: string): number | null {
  const a = utcOf(from);
  const b = utcOf(to);
  return a === null || b === null ? null : Math.round((b - a) / DAY_MS);
}

/**
 * URLの `d` から表示する日のずれ（今日=0）を決める。無い・読めない値は今日、範囲外は端へ丸める。
 * 配列（`?d=a&d=b`）は先頭だけ読む。
 */
export function resolveDayOffset(todayKey: string, raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return 0;
  const diff = dayDiff(todayKey, value);
  if (diff === null) return 0;
  return Math.max(-DAY_RANGE, Math.min(DAY_RANGE, diff));
}

/** ずれ `offset` の日を開くパス。今日は `/`（通知の遷移先と同じ形に揃える）。 */
export function dayHref(todayKey: string, offset: number): string {
  return offset === 0 ? "/" : `/?d=${addDays(todayKey, offset)}`;
}

/** 見出しに添える相対の呼び方。近い日だけ名前があり、それ以外はnull。 */
export function relativeDayName(offset: number): string | null {
  switch (offset) {
    case -2:
      return "おととい";
    case -1:
      return "きのう";
    case 0:
      return "今日";
    case 1:
      return "明日";
    case 2:
      return "明後日";
    default:
      return null;
  }
}

/** カードの見出しに入れる日の呼び方（「今日の天気」「明日の予定」「10月25日の天気」）。 */
export function cardDayName(dayKey: string, offset: number): string {
  if (offset === 0) return "今日";
  if (offset === 1) return "明日";
  if (offset === -1) return "きのう";
  const [, month, day] = dayKey.split("-");
  return `${Number(month)}月${Number(day)}日`;
}
