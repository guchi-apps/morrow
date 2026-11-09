import assert from "node:assert/strict";
import { test } from "node:test";

import { ANALYZE_RETRY_MAX, shouldRetryAnalysis } from "../src/lib/mail/analyze-retry.ts";

test("429と通信失敗は取り直す", () => {
  assert.equal(shouldRetryAnalysis(429, 0), true);
  assert.equal(shouldRetryAnalysis("network", 0), true);
});

test("確定した答えは取り直さない", () => {
  for (const status of [400, 401, 403, 404, 502]) assert.equal(shouldRetryAnalysis(status, 0), false);
});

test("上限を超えたら取り直さない", () => {
  assert.equal(shouldRetryAnalysis("network", ANALYZE_RETRY_MAX - 1), true);
  assert.equal(shouldRetryAnalysis("network", ANALYZE_RETRY_MAX), false);
  assert.equal(shouldRetryAnalysis(429, ANALYZE_RETRY_MAX), false);
});
