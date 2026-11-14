import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { matchQueryOf, matchRegistered, matchSubscriptions, normalizeSubscriptionName, parseRegisteredSubscriptions } from "@/lib/mail/subscription-match-core";
import type { Suggestion } from "@/lib/mail/suggest-core";
import { registeredDetails, registeredSummary } from "@/lib/mail/subscription-match-view";

/**
 * Asset Managerの登録済みサブスクとの照合（#884）。
 * 応答の例は2026-11-14にAIDEの `asset_manager_subscriptions`（読み取り）を実際に呼んで得た形（名前「JAF」・金額などは実値の一部、不要な項目は省略）。
 */
const response = {
  status: "ok",
  asOf: "2026-11-14",
  summary: { activeCount: 25 },
  subscriptions: [
    { id: 33, name: "JAF", status: "AUTO_RENEWING", statusLabel: "自動更新中", paymentMethod: "三井住友ゴールドカード VISA", labels: ["車"], amount: 4000, currency: "JPY", billing: "毎年12月1日", billingCycle: "YEARLY", nextBillingDay: "2026-12-01", daysUntilNextBilling: 17, startDate: "2025-12-01" },
    { id: 1, name: "Claude", statusLabel: "自動更新中", paymentMethod: "ANA JCB CARD FIRST", labels: [], amount: 17600, currency: "JPY", billing: "毎月14日", billingCycle: "MONTHLY", nextBillingDay: "2026-11-14", daysUntilNextBilling: 0, startDate: null },
    { id: 2, name: "お名前.com (gucchii.com)", statusLabel: "自動更新中", amount: 1500, currency: "JPY" },
    { id: 3, name: "お名前.com (minagu.work)", statusLabel: "自動更新中", amount: 1500, currency: "JPY" },
  ],
};

describe("parseRegisteredSubscriptions", () => {
  it("実応答を読める", () => {
    const list = parseRegisteredSubscriptions(response);
    assert.equal(list?.length, 4);
    assert.deepEqual(list?.[0], {
      id: 33, name: "JAF", statusLabel: "自動更新中", amount: 4000, currency: "JPY", billing: "毎年12月1日", billingCycle: "YEARLY",
      nextBillingDay: "2026-12-01", daysUntilNextBilling: 17, startDate: "2025-12-01", paymentMethod: "三井住友ゴールドカード VISA", labels: ["車"],
    });
  });
  it("形が違う応答はnull（「無い」と混ぜない）", () => {
    assert.equal(parseRegisteredSubscriptions(null), null);
    assert.equal(parseRegisteredSubscriptions({ status: "error" }), null);
    assert.equal(parseRegisteredSubscriptions({ status: "ok" }), null);
  });
});

describe("matchSubscriptions", () => {
  const list = parseRegisteredSubscriptions(response)!;
  it("提案の名称が登録名を含む（JAF年会費→JAF）", () => {
    assert.deepEqual(matchSubscriptions("JAF年会費", list).map((r) => r.id), [33]);
  });
  it("全角半角・大文字小文字・記号の違いを無視する", () => {
    assert.deepEqual(matchSubscriptions("ＣＬＡＵＤＥ", list).map((r) => r.id), [1]);
    assert.equal(normalizeSubscriptionName("お名前.com (gucchii.com)"), "お名前comgucchiicom");
  });
  it("完全一致があればそれだけ、無ければ複数の候補", () => {
    assert.deepEqual(matchSubscriptions("お名前.com (minagu.work)", list).map((r) => r.id), [3]);
    assert.deepEqual(matchSubscriptions("お名前.com", list).map((r) => r.id), [2, 3]);
  });
  it("見つからない・短すぎる名前は当てない", () => {
    assert.deepEqual(matchSubscriptions("Netflix", list), []);
    assert.deepEqual(matchSubscriptions("J", list), []);
    assert.deepEqual(matchSubscriptions("  ", list), []);
  });
});

/**
 * 名前で見つからなければ金額で照合する（#896）。KDDIの請求（2円）が「iPhone15」（2円・毎月30日）として登録されていた実例
 * （2026-11-14にAIDEの `asset_manager_subscriptions` で確認）。
 */
describe("matchRegistered", () => {
  const list = parseRegisteredSubscriptions({
    ...response,
    subscriptions: [...response.subscriptions, { id: 35, name: "iPhone15", statusLabel: "自動更新中", amount: 2, currency: "JPY", billing: "毎月30日", billingCycle: "MONTHLY" }, { id: 41, name: "ドル建て", amount: 2, currency: "USD" }],
  })!;
  it("名前で見つからず、円建ての金額が一致する登録が1件なら金額で一致", () => {
    const m = matchRegistered({ names: ["KDDI", "KDDIサービス料金（2026年11月分）"], amount: 2, currency: "JPY" }, list);
    assert.equal(m.status, "matched");
    assert.equal(m.status === "matched" && m.by, "amount");
    assert.deepEqual(m.status === "matched" && m.matches.map((r) => r.id), [35]);
  });
  it("名前の一致を金額より優先し、並びの先から試す", () => {
    const m = matchRegistered({ names: ["Netflix", "JAF年会費"], amount: 2, currency: "JPY" }, list);
    assert.equal(m.status === "matched" && m.by, "name");
    assert.deepEqual(m.status === "matched" && m.matches.map((r) => r.id), [33]);
  });
  it("同じ金額が複数・外貨・金額なし・0円は当てない", () => {
    assert.deepEqual(matchRegistered({ names: ["Netflix"], amount: 1500, currency: "JPY" }, list), { status: "none" });
    assert.deepEqual(matchRegistered({ names: [], amount: 2, currency: "USD" }, list), { status: "none" });
    assert.deepEqual(matchRegistered({ names: ["Netflix"], amount: null, currency: "JPY" }, list), { status: "none" });
    assert.deepEqual(matchRegistered({ names: [], amount: 0, currency: "JPY" }, list), { status: "none" });
  });
});

describe("matchQueryOf", () => {
  const payment = (fields: Partial<Extract<Suggestion, { kind: "payment" }>["fields"]>): Suggestion => ({
    kind: "payment",
    reason: "",
    confidence: 0.9,
    fields: { place: "KDDI", name: "KDDIサービス料金", amount: 2, date: null, time: null, items: [], usage: null, originalAmount: null, originalCurrency: null, ...fields },
  });
  it("家計簿は支払先・品名と円建ての合計", () => {
    assert.deepEqual(matchQueryOf(payment({})), { names: ["KDDI", "KDDIサービス料金"], amount: 2, currency: "JPY" });
  });
  it("品目が複数なら品名は使わない・金額が無ければ通貨もnull", () => {
    const items = [{ name: "a", amount: 1, quantity: null }, { name: "b", amount: 1, quantity: null }];
    assert.deepEqual(matchQueryOf(payment({ items, amount: null })), { names: ["KDDI"], amount: null, currency: null });
  });
  it("外貨建ての家計簿は金額で照合しない", () => {
    assert.deepEqual(matchQueryOf(payment({ amount: 1500, originalAmount: 10, originalCurrency: "USD" })), { names: ["KDDI", "KDDIサービス料金"], amount: null, currency: null });
  });
  it("サブスクは名称・金額・通貨、予定・手掛かりの無い提案はnull", () => {
    assert.deepEqual(matchQueryOf({ kind: "subscription", reason: "", confidence: 1, fields: { name: "JAF", amount: 4000, currency: "JPY", cycle: "YEARLY", day: 1, startDate: null } }), { names: ["JAF"], amount: 4000, currency: "JPY" });
    assert.equal(matchQueryOf({ kind: "task", reason: "", confidence: 1, fields: { title: "x", due: null, dueTime: null, planned: null, plannedTime: null, memo: "" } }), null);
    assert.equal(matchQueryOf(payment({ place: null, name: "", amount: null })), null);
  });
});

describe("表示の整形", () => {
  const jaf = parseRegisteredSubscriptions(response)![0];
  it("行の1行", () => assert.equal(registeredSummary(jaf), "JAF・4,000円・毎年・次回 12/1"));
  it("詳細の項目", () => {
    assert.deepEqual(registeredDetails(jaf).map((r) => [r.label, r.value]), [
      ["1回あたりの金額", "4,000円"],
      ["請求サイクル", "毎年12月1日"],
      ["次回請求日", "2026/12/01（あと17日）"],
      ["支払方法", "三井住友ゴールドカード VISA"],
      ["契約開始日", "2025/12/01"],
      ["ラベル", "車"],
    ]);
  });
});
