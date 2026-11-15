import assert from "node:assert/strict";
import { test } from "node:test";

import { buildDailyUsage, formatTokens, niceMax, recentDayKeys } from "../src/lib/usage-daily.ts";
import { usageBucketOf } from "../src/lib/usage-feature.ts";

const row = (at: string, feature: string, input = 100, output = 10, cacheRead = 0, model = "gpt-6-luna") => ({
  createdAt: new Date(at),
  model,
  feature,
  inputTokens: input,
  outputTokens: output,
  cacheWriteTokens: 0,
  cacheReadTokens: cacheRead,
});

test("日本時間の日付で畳み、記録の無い日は0で埋める", () => {
  const now = new Date("2026-11-15T03:00:00Z"); // 日本時間 11/15 12:00
  const days = buildDailyUsage([], now, 3);
  assert.deepEqual(days.map((d) => d.day), ["2026-11-13", "2026-11-14", "2026-11-15"]);
  assert.ok(days.every((d) => d.total === 0 && d.calls === 0));
});

test("UTCの15時以降は日本時間の翌日に入る", () => {
  const now = new Date("2026-11-15T03:00:00Z");
  const days = buildDailyUsage([row("2026-11-14T15:30:00Z", "topic"), row("2026-11-14T14:59:00Z", "topic")], now, 3);
  assert.equal(days[2].buckets.topic.calls, 1); // 11/15 0:30 JST
  assert.equal(days[1].buckets.topic.calls, 1); // 11/14 23:59 JST
});

test("機能を用途へ畳み、未知の機能・空文字はその他へ入れる。窓の外は捨てる", () => {
  const now = new Date("2026-11-15T03:00:00Z");
  const days = buildDailyUsage(
    [
      row("2026-11-15T01:00:00Z", "mail_learn", 100, 10, 50),
      row("2026-11-15T01:00:00Z", "mail_chat"),
      row("2026-11-15T01:00:00Z", ""),
      row("2026-11-15T01:00:00Z", "removed_feature"),
      row("2026-11-01T01:00:00Z", "topic"),
    ],
    now,
    3,
  );
  const today = days[2];
  assert.equal(today.buckets.mail.total, 160);
  assert.equal(today.buckets.mail.cache, 50);
  assert.equal(today.buckets.mail_suggest.calls, 1);
  assert.equal(today.buckets.other.calls, 2);
  assert.equal(today.total, 160 + 110 + 110 + 110);
  assert.equal(usageBucketOf("topic"), "topic");
});

test("recentDayKeys は今日が末尾", () => {
  assert.equal(recentDayKeys(new Date("2026-11-15T03:00:00Z"), 1)[0], "2026-11-15");
});

test("トークン数の表記と縦軸の丸め", () => {
  assert.equal(formatTokens(999), "999");
  assert.equal(formatTokens(1500), "1.5k");
  assert.equal(formatTokens(320000), "320k");
  assert.equal(formatTokens(2_400_000), "2.4M");
  assert.equal(niceMax(0), 1);
  assert.equal(niceMax(380000), 500000);
  assert.equal(niceMax(100), 100);
});

test("概算金額は行のモデルの単価で換算し、単価の無いモデルは金額に含めず数える", () => {
  const now = new Date("2026-11-15T03:00:00Z");
  const days = buildDailyUsage(
    [
      row("2026-11-15T01:00:00Z", "topic", 1_000_000, 1_000_000, 0, "gpt-6-sol"), // $2 + $10
      row("2026-11-15T01:00:00Z", "topic", 1_000_000, 0, 0, "gpt-6-astra"), // 単価なし
    ],
    now,
    1,
  );
  assert.equal(days[0].costUsd, 12);
  assert.equal(days[0].unpricedCalls, 1);
  assert.equal(days[0].buckets.topic.costUsd, 12);
  assert.equal(days[0].buckets.topic.unpricedCalls, 1);
});
