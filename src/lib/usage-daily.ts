import { jstDayKey } from "@/lib/day-key";
import { estimateCostUsd } from "@/lib/model-pricing";
import { usageBucketOf, type UsageBucket } from "@/lib/usage-feature";

/**
 * モデル画面の使用量グラフ（#945）の集計。**Prismaに触れない純粋なモジュール**（クライアントからも
 * importする。DBの取り出しは `@/lib/usage` の `dailyUsageRows()`）。
 *
 * 金額は公開API価格での換算の目安（#996。`@/lib/model-pricing`）。Codexはサブスク定額で実際の請求は無い。
 * 単価の無いモデルの呼び出しは金額に含めず、`unpricedCalls` で数える。
 * 日付の境目は日本時間（`jstDayKey()`）。
 */

/** グラフで引く最長の日数（画面の期間タブはこの範囲で切り替える）。 */
export const USAGE_CHART_DAYS = 30;

export const USAGE_BUCKETS: readonly UsageBucket[] = ["topic", "mail_suggest", "mail", "other"];

export type UsageRowLike = {
  createdAt: Date;
  model: string;
  feature: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
};

export type BucketUsage = {
  /** 入力・出力・キャッシュの合計。 */
  total: number;
  /** キャッシュに載らなかった入力。 */
  input: number;
  output: number;
  cache: number;
  calls: number;
  /** 単価のあるモデルの呼び出しの概算金額（USD）。 */
  costUsd: number;
  /** 単価が無く金額に含められなかった呼び出し数。 */
  unpricedCalls: number;
};

export type DayUsage = {
  /** `2026-11-15`（日本時間）。 */
  day: string;
  total: number;
  calls: number;
  costUsd: number;
  unpricedCalls: number;
  buckets: Record<UsageBucket, BucketUsage>;
};

function emptyBucket(): BucketUsage {
  return { total: 0, input: 0, output: 0, cache: 0, calls: 0, costUsd: 0, unpricedCalls: 0 };
}

/** 今日を末尾に、`days` 日ぶんの日付の鍵を古い順に返す。 */
export function recentDayKeys(now: Date, days: number): string[] {
  const keys: string[] = [];
  for (let back = days - 1; back >= 0; back -= 1) {
    keys.push(jstDayKey(new Date(now.getTime() - back * 24 * 60 * 60 * 1000)));
  }
  return keys;
}

/** 記録を日本時間の日付×用途へ畳む。記録の無い日も0で埋め、窓の外の行は捨てる。 */
export function buildDailyUsage(rows: UsageRowLike[], now: Date, days: number): DayUsage[] {
  const result = recentDayKeys(now, days).map<DayUsage>((day) => ({
    day,
    total: 0,
    calls: 0,
    costUsd: 0,
    unpricedCalls: 0,
    buckets: { topic: emptyBucket(), mail_suggest: emptyBucket(), mail: emptyBucket(), other: emptyBucket() },
  }));
  const byDay = new Map(result.map((entry) => [entry.day, entry]));

  for (const row of rows) {
    const entry = byDay.get(jstDayKey(row.createdAt));
    if (!entry) continue;

    const bucket = entry.buckets[usageBucketOf(row.feature)];
    const cache = row.cacheWriteTokens + row.cacheReadTokens;
    const total = row.inputTokens + row.outputTokens + cache;

    bucket.total += total;
    bucket.input += row.inputTokens;
    bucket.output += row.outputTokens;
    bucket.cache += cache;
    bucket.calls += 1;
    entry.total += total;
    entry.calls += 1;

    const cost = estimateCostUsd(row.model, row);
    if (cost === null) {
      bucket.unpricedCalls += 1;
      entry.unpricedCalls += 1;
    } else {
      bucket.costUsd += cost;
      entry.costUsd += cost;
    }
  }

  return result;
}

/** トークン数の短い表記（`1.2k`・`3.4M`）。 */
export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(value);
}

/** 縦軸の上端（見やすい丸め）。 */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(value));
  const n = value / exp;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * exp;
}
