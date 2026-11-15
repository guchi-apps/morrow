/**
 * モデルごとの単価（USD / 100万トークン）と概算金額の計算（#996）。**Prismaに触れない純粋なモジュール**
 * （クライアントからもimportする）。
 *
 * 単価の正は StatusHub の `src/lib/ai-app-usage/models.ts`（`MODELS`）。StatusHub には単価を返すAPIが
 * 無くコード内の定数だけなので、Morrowが使い得る行をここへ**写している**。StatusHub 側が直ったら
 * ここも直す（二重管理）。使うのは `ApiUsage.model` に残るモデル名なので、いまの選択肢（GPT-6系）だけでなく
 * 過去の記録に残るGPT-5.6系・Claude系も残す。
 *
 * Codexはサブスク定額で実際の請求は無い。ここの金額は公開API価格での**換算の目安**。
 * 表に無いモデル（`gpt-6-astra` など）は金額を出さず、推測もしない（`null`）。
 */

export type ModelPrice = {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  /** 出典が未確認・換算の目安など。画面にも出す。 */
  note?: string;
};

/** StatusHub の単価表の写し（2026-11-15時点）。 */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-fable-5-1": { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 0.25 },
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-sonnet-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  "gpt-5.6-sol": { input: 4, output: 20, cacheWrite: 4, cacheRead: 0.4, note: "換算の目安" },
  "gpt-5.6-terra": { input: 2, output: 12, cacheWrite: 2, cacheRead: 0.2, note: "換算の目安" },
  "gpt-5.6-luna": { input: 0.2, output: 1.2, cacheWrite: 0.2, cacheRead: 0.02, note: "換算の目安" },
  "gpt-6-sol": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2, note: "出典未確認" },
  "gpt-6-luna": { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01, note: "出典未確認" },
};

/** 円換算の目安に使う固定レート（為替には連動しない）。 */
export const JPY_PER_USD = 150;

/**
 * モデル名から単価を引く。日付付きのID（`claude-haiku-4-5-20251001`）も同じモデルとして扱うが、
 * 完全一致を先に確かめる（`claude-opus-5-5` が `claude-opus-5` の前方一致に拾われないように）。
 */
export function priceOf(model: string): ModelPrice | null {
  const normalized = model.trim().toLowerCase();
  if (MODEL_PRICES[normalized]) return MODEL_PRICES[normalized];
  const key = Object.keys(MODEL_PRICES).find((id) => normalized.startsWith(`${id}-`));
  return key ? MODEL_PRICES[key] : null;
}

export type TokenCounts = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

/** 概算金額（USD）。単価の無いモデルは null。`inputTokens` はキャッシュに載らなかった分（ApiUsageと同じ）。 */
export function estimateCostUsd(model: string, tokens: TokenCounts): number | null {
  const price = priceOf(model);
  if (!price) return null;
  return (
    (tokens.inputTokens * price.input +
      tokens.outputTokens * price.output +
      tokens.cacheReadTokens * price.cacheRead +
      tokens.cacheWriteTokens * price.cacheWrite) /
    1_000_000
  );
}

/** 金額の短い表記（`$0.62`・`$12`）。1ドル未満は小数2桁、極小は `<$0.01`。 */
export function formatUsd(value: number): string {
  if (value <= 0) return "$0";
  if (value < 0.01) return "<$0.01";
  if (value < 10) return `$${value.toFixed(2)}`;
  return `$${Math.round(value)}`;
}

/** 円換算の目安（固定レート）。 */
export function formatJpy(usd: number): string {
  return `約¥${Math.round(usd * JPY_PER_USD).toLocaleString("ja-JP")}`;
}

/** モデルの単価の目安（`$2 / $10`）。単価が無ければ null。 */
export function priceLabel(model: string): string | null {
  const price = priceOf(model);
  if (!price) return null;
  const fmt = (n: number) => `$${n}`;
  return `${fmt(price.input)} / ${fmt(price.output)}`;
}
