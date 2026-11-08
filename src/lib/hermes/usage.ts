import type { HermesUsage } from "./contract.ts";

/**
 * Hermesの `message.complete.usage` を `ApiUsage` の列へ写す（純粋。#737。対応表は #725）。
 *
 * **serveの `input` はキャッシュを除いた値**（`prompt` が込みの総量）なので、Codexと違って引き算しない。
 * キャッシュの項目が無いときは `prompt − input` を読み込みぶんとみなす。`reasoning` は内数か未確認のため足さない。
 * 取れない回（`usage` が無い）は `null`（行を作らない。`recordApiUsage()` も全部0を落とす）。
 */

export const HERMES_DEFAULT_MODEL = "hermes";

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

export interface HermesApiUsage {
  model: string;
  usage: { inputTokens: number; outputTokens: number; cacheWriteTokens: number; cacheReadTokens: number };
}

export function hermesUsageToApiUsage(usage: HermesUsage | undefined): HermesApiUsage | null {
  if (!usage) return null;
  const inputTokens = count(usage.input);
  const cacheWriteTokens = count(usage.cache_write);
  const cacheReadTokens =
    usage.cache_read !== undefined ? count(usage.cache_read) : Math.max(0, count(usage.prompt) - inputTokens - cacheWriteTokens);
  const outputTokens = count(usage.output);
  if (inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens <= 0) return null;
  return {
    model: typeof usage.model === "string" && usage.model !== "" ? usage.model.slice(0, 64) : HERMES_DEFAULT_MODEL,
    usage: { inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens },
  };
}
