import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isLinkableKind, parseRegisteredSubscriptions, resolveMatch } from "@/lib/mail/subscription-match-core";

/** 定期払いの手動の紐づけ（#1130）。手動の選択が自動照合より優先されること。 */
const registered = parseRegisteredSubscriptions({
  status: "ok",
  subscriptions: [
    { id: 1, name: "Apple Developer Program", amount: 12800, currency: "JPY" },
    { id: 2, name: "Typeless Pro", amount: 10000, currency: "JPY" },
  ],
})!;
const query = { names: ["Apple"], amount: 10000, currency: "JPY" as const };

describe("resolveMatch", () => {
  it("手動の選択が無ければ自動照合（名前）", () => {
    const m = resolveMatch(query, registered, null);
    assert.equal(m.status, "matched");
    if (m.status === "matched") assert.deepEqual([m.by, m.matches[0].id], ["name", 1]);
  });
  it("手動で別の定期払いを選べば、名前が合う方より優先される", () => {
    const m = resolveMatch(query, registered, { subscriptionId: 2 });
    assert.equal(m.status, "matched");
    if (m.status === "matched") assert.deepEqual([m.by, m.matches.map((r) => r.id)], ["manual", [2]]);
  });
  it("紐づけなしを選べば、自動で見つかる相手がいても出さない", () => {
    assert.deepEqual(resolveMatch(query, registered, { subscriptionId: null }), { status: "unlinked" });
  });
  it("選んだ登録が一覧から消えていたら自動照合へ戻す", () => {
    const m = resolveMatch(query, registered, { subscriptionId: 999 });
    assert.equal(m.status === "matched" && m.by, "name");
  });
});

describe("isLinkableKind", () => {
  it("家計簿とサブスクだけ", () => {
    assert.equal(isLinkableKind("payment"), true);
    assert.equal(isLinkableKind("subscription"), true);
    assert.equal(isLinkableKind("task"), false);
    assert.equal(isLinkableKind(undefined), false);
  });
});
