import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { matchSubscriptions, normalizeSubscriptionName, parseRegisteredSubscriptions } from "@/lib/mail/subscription-match-core";
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
