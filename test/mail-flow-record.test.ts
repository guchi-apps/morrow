import assert from "node:assert/strict";
import { test } from "node:test";

import { contentKeyOf, flowRowStates, flowStatusLabel, recordStatusOf, summarizeSuggestion } from "@/lib/mail/flow-record-core";
import { normalizeSuggestion } from "@/lib/mail/suggest-core";

test("支払いの要約は支払先・金額・日付", () => {
  const s = normalizeSuggestion("payment", { place: "東京電力", name: "電気代", amount: 8420, date: "2026-11-05" });
  assert.ok(s);
  assert.equal(summarizeSuggestion(s), "東京電力 / 電気代 / 8,420円 / 11/5");
});

test("品目に分かれた支払いは先頭の品目と件数、金額が無ければ品目の合計（#781）", () => {
  const s = normalizeSuggestion("payment", {
    place: "Amazon",
    name: "",
    date: "2026-11-07",
    items: [
      { name: "電池", amount: 1280 },
      { name: "配送料", amount: 410 },
    ],
  });
  assert.ok(s);
  assert.equal(summarizeSuggestion(s), "Amazon / 電池 ほか1件 / 1,690円 / 11/7");
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

test("家計簿の確認待ち・取り込み済みの控えは登録済みの印にしない（#821）", () => {
  assert.deepEqual(flowRowStates([{ kind: "payment", status: "pending" }]), { registeredKinds: [], receiptState: "pending" });
  assert.deepEqual(flowRowStates([{ kind: "payment", status: "duplicate" }]), { registeredKinds: [], receiptState: "duplicate" });
  // 確認待ちが残っていれば、重複の控えが並んでも確認待ちのまま
  assert.equal(flowRowStates([{ kind: "payment", status: "duplicate" }, { kind: "payment", status: "pending" }]).receiptState, "pending");
  // 完了の控えがあれば登録済み
  assert.deepEqual(flowRowStates([{ kind: "payment", status: "pending" }, { kind: "payment", status: "done" }]), { registeredKinds: ["payment"], receiptState: null });
  // ほかの種類の重複は従来どおり登録済み。サブスクの「開いた」は含めない
  assert.deepEqual(flowRowStates([{ kind: "task", status: "duplicate" }, { kind: "subscription", status: "opened" }]), { registeredKinds: ["task"], receiptState: null });
});

test("家計簿の重複の控えは「登録済み」と書かない（#821）", () => {
  assert.ok(!flowStatusLabel("payment", "duplicate")?.includes("登録済み"));
  assert.equal(flowStatusLabel("task", "duplicate"), "登録済み（重複を検出）");
});

test("受信日で補った購入日は控えで「（受信日）」と区別する（#903）", () => {
  const s = normalizeSuggestion("payment", { place: "KDDI", name: "料金", amount: 2, date: "2026-11-14", dateEstimated: true })!;
  assert.match(summarizeSuggestion(s), /11\/14（受信日）/);
  const t = normalizeSuggestion("payment", { place: "KDDI", name: "料金", amount: 2, date: "2026-11-14" })!;
  assert.doesNotMatch(summarizeSuggestion(t), /受信日/);
});
