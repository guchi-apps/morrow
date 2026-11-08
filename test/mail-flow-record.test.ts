import assert from "node:assert/strict";
import { test } from "node:test";

import { contentKeyOf, recordStatusOf, summarizeSuggestion } from "@/lib/mail/flow-record-core";
import { normalizeSuggestion } from "@/lib/mail/suggest-core";

test("支払いの要約は支払先・金額・日付", () => {
  const s = normalizeSuggestion("payment", { place: "東京電力", name: "電気代", amount: 8420, date: "2026-11-05" });
  assert.ok(s);
  assert.equal(summarizeSuggestion(s), "東京電力 / 電気代 / 8,420円 / 11/5");
});

test("読み取れない項目は省く", () => {
  const s = normalizeSuggestion("task", { title: "書類を出す", due: null, memo: "" });
  assert.ok(s);
  assert.equal(summarizeSuggestion(s), "書類を出す");
});

test("予定は日付と時刻を添える", () => {
  const s = normalizeSuggestion("event", { title: "内覧", date: "2026-11-15", startTime: "10:00", endTime: "11:00", location: null });
  assert.ok(s);
  assert.equal(summarizeSuggestion(s), "内覧 / 11/15 10:00–11:00");
});

test("サブスクは名称・金額・周期", () => {
  const s = normalizeSuggestion("subscription", { name: "動画配信", amount: 1290, currency: "JPY", cycle: "MONTHLY", day: null, startDate: null });
  assert.ok(s);
  assert.equal(summarizeSuggestion(s), "動画配信 / 1,290円 / 毎月");
});

test("失敗は記録しない・重複と確認待ちは残す", () => {
  assert.equal(recordStatusOf({ status: "failed", message: "" }), null);
  assert.equal(recordStatusOf({ status: "duplicate", message: "" }), "duplicate");
  assert.equal(recordStatusOf({ status: "pending", message: "" }), "pending");
});

test("同じ要約は同じ鍵", () => {
  assert.equal(contentKeyOf("a"), contentKeyOf("a"));
  assert.notEqual(contentKeyOf("a"), contentKeyOf("b"));
});
