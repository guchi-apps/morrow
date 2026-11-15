import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeSuggestion, parseSuggestReply, toolCallFor } from "../src/lib/mail/suggest-core.ts";
import { guessCarrier, normalizeTrackingNumber, trackingBlocker, trackingUrl } from "../src/lib/mail/tracking-link.ts";

describe("追跡番号の正規化と検証（#972）", () => {
  it("ハイフン・空白・全角を落とす", () => {
    assert.equal(normalizeTrackingNumber("３３５０-8290 8392"), "335082908392");
    assert.equal(normalizeTrackingNumber("ej123456789jp"), "EJ123456789JP");
    assert.equal(normalizeTrackingNumber(null), "");
  });

  it("会社ごとの桁数", () => {
    assert.equal(trackingBlocker("yamato", "335082908392"), null);
    assert.notEqual(trackingBlocker("yamato", "33508290839"), null);
    assert.equal(trackingBlocker("sagawa", "123456789012"), null);
    assert.equal(trackingBlocker("japanpost", "12345678901"), null);
    assert.equal(trackingBlocker("japanpost", "1234567890123"), null);
    assert.equal(trackingBlocker("japanpost", "EJ123456789JP"), null);
    assert.notEqual(trackingBlocker("japanpost", "1234"), null);
    assert.notEqual(trackingBlocker(null, "335082908392"), null);
    assert.notEqual(trackingBlocker("yamato", ""), null);
  });

  it("番号の形で決められるときだけ会社を補う", () => {
    assert.equal(guessCarrier("EJ123456789JP"), "japanpost");
    assert.equal(guessCarrier("12345678901"), "japanpost");
    assert.equal(guessCarrier("335082908392"), null);
  });
});

describe("追跡URL", () => {
  it("番号入りのURLを作る", () => {
    assert.equal(trackingUrl("yamato", "335082908392"), "https://jizen.kuronekoyamato.co.jp/jizen/servlet/crjz.b.NQ0010?id=335082908392");
    assert.equal(trackingUrl("sagawa", "123456789012"), "https://k2k.sagawa-exp.co.jp/p/web/okurijosearch.do?okurijoNo=123456789012");
    assert.equal(
      trackingUrl("japanpost", "EJ123456789JP"),
      "https://trackings.post.japanpost.jp/services/srv/search/direct?searchKind=S004&locale=ja&reqCodeNo1=EJ123456789JP",
    );
  });

  it("検証を通らない組み合わせはnull", () => {
    assert.equal(trackingUrl("yamato", "1234"), null);
    assert.equal(trackingUrl(null, "335082908392"), null);
  });
});

describe("提案としての読み取り", () => {
  it("返答のtrackingを読み、番号を正規化する", () => {
    const reply = JSON.stringify({
      recommended: "tracking",
      suggestions: [{ kind: "tracking", reason: "受付番号あり", confidence: 0.9, fields: { carrier: "yamato", number: "3350-8290-8392" } }],
    });
    const result = parseSuggestReply(reply);
    assert.equal(result?.recommended, "tracking");
    assert.deepEqual(result?.suggestions[0]?.fields, { carrier: "yamato", number: "335082908392" });
  });

  it("有効な候補が4件以上でtrackingが4件目でも、追跡提案は上限内に残る（#983）", () => {
    const reply = JSON.stringify({
      recommended: "payment",
      suggestions: [
        { kind: "payment", confidence: 0.9, fields: { name: "通販", amount: 1000, date: "2026-11-05" } },
        { kind: "subscription", confidence: 0.8, fields: { name: "会員", amount: 500 } },
        { kind: "task", confidence: 0.7, fields: { title: "受け取る" } },
        { kind: "tracking", confidence: 0.6, fields: { carrier: "yamato", number: "335082908392" } },
      ],
    });
    const result = parseSuggestReply(reply);
    assert.equal(result?.suggestions.length, 3);
    assert.deepEqual(result?.suggestions.map((s) => s.kind), ["payment", "subscription", "tracking"]);
    assert.equal(result?.recommended, "payment");
  });

  it("会社が不正でも、番号から決められなければnullのまま残す。番号が無ければ捨てる", () => {
    assert.deepEqual(normalizeSuggestion("tracking", { carrier: "fedex", number: "335082908392" })?.fields, { carrier: null, number: "335082908392" });
    assert.equal(normalizeSuggestion("tracking", { carrier: "yamato", number: "" }), null);
  });

  it("Morrowからは実行しない", () => {
    const suggestion = normalizeSuggestion("tracking", { carrier: "yamato", number: "335082908392" })!;
    assert.equal(toolCallFor(suggestion, { messageId: "m", subject: "s", from: "f", receivedAt: null }, "u").ok, false);
  });
});
