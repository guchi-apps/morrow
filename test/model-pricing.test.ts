import assert from "node:assert/strict";
import { test } from "node:test";

import { estimateCostUsd, formatJpy, formatUsd, priceLabel, priceOf } from "../src/lib/model-pricing.ts";

const tokens = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 };

test("入力・出力・キャッシュ読み出しを単価で足す", () => {
  // gpt-6-sol: 2 + 10 + 0.2
  assert.equal(estimateCostUsd("gpt-6-sol", tokens), 12.2);
});

test("単価の無いモデルは null（推測しない）", () => {
  assert.equal(estimateCostUsd("gpt-6-astra", tokens), null);
  assert.equal(priceLabel("gpt-6-astra"), null);
});

test("完全一致を先に引き、日付付きIDは前方一致で拾う", () => {
  assert.equal(priceOf("claude-opus-5-5")?.input, 4);
  assert.equal(priceOf("claude-opus-5")?.input, 5);
  assert.equal(priceOf("claude-haiku-4-5-20251001")?.input, 1);
});

test("金額の表記と円換算", () => {
  assert.equal(formatUsd(0), "$0");
  assert.equal(formatUsd(0.001), "<$0.01");
  assert.equal(formatUsd(0.616), "$0.62");
  assert.equal(formatUsd(12.4), "$12");
  assert.equal(formatJpy(4.2), "約¥630");
  assert.equal(priceLabel("gpt-6-luna"), "$0.1 / $0.5");
});
