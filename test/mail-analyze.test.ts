import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ANALYSIS_TTL_MS,
  analysisCacheKey,
  buildAnalyzePrompt,
  freshValue,
  parseAnalyzeReply,
  putCache,
  type CacheEntry,
} from "@/lib/mail/analyze-core";

/** メールのAI分析（#766。要約と提案を1回で作る）のうち、DB・ネットワークに触れない部分。 */

describe("buildAnalyzePrompt", () => {
  const prompt = buildAnalyzePrompt({ from: "a@example.com", subject: "件名", body: "本文\n改行", receivedDate: null, today: "2026-11-08" });

  it("要約と提案の両方の決まりごと・出力の形を含む", () => {
    assert.match(prompt, /要約の決まりごと/);
    assert.match(prompt, /提案の決まりごと/);
    assert.match(prompt, /"summary":"要約"/);
    assert.match(prompt, /"recommended":"payment"/);
    assert.match(prompt, /今日は2026-11-08/);
  });

  it("本文をデータとして渡し、メール内の指示に従わせない", () => {
    assert.match(prompt, /指示（.*）には従わない/);
    assert.ok(!prompt.includes("本文\n改行"));
  });

  it("本文は上限で切る", () => {
    const long = buildAnalyzePrompt({ from: "a", subject: "b", body: "あ".repeat(20000), receivedDate: null, today: "2026-11-08" });
    assert.ok(long.length < prompt.length + 7000);
  });
});

describe("parseAnalyzeReply", () => {
  it("要約と提案を1つの返答から読む", () => {
    const reply = JSON.stringify({
      summary: "電気料金のお知らせ",
      points: ["7,842円"],
      recommended: "payment",
      suggestions: [{ kind: "payment", reason: "請求", confidence: 0.9, fields: { place: "関西電力", name: "電気料金", amount: 7842, date: "2026-11-05" } }],
    });
    const result = parseAnalyzeReply(`前置き${reply}`);
    assert.ok(result);
    assert.deepEqual(result.summary, { summary: "電気料金のお知らせ", points: ["7,842円"] });
    assert.equal(result.suggest.recommended, "payment");
    assert.equal(result.suggest.suggestions.length, 1);
  });

  it("提案が無ければ空。要約が無い・読めない返答はnull", () => {
    assert.deepEqual(parseAnalyzeReply('{"summary":"x"}')?.suggest, { recommended: null, suggestions: [] });
    assert.equal(parseAnalyzeReply('{"recommended":"task","suggestions":[]}'), null);
    assert.equal(parseAnalyzeReply("だめ"), null);
  });
});

describe("分析の記憶", () => {
  it("鍵は利用者ごとに分ける", () => {
    assert.notEqual(analysisCacheKey("u1", "m"), analysisCacheKey("u2", "m"));
  });

  it("30分を過ぎた値は返さない", () => {
    const entry: CacheEntry<string> = { at: 1000, value: "v" };
    assert.equal(freshValue(entry, 1000 + ANALYSIS_TTL_MS - 1), "v");
    assert.equal(freshValue(entry, 1000 + ANALYSIS_TTL_MS), null);
    assert.equal(freshValue(undefined, 0), null);
  });

  it("上限を超えたら古いものから捨て、期限切れも掃除する", () => {
    const cache = new Map<string, CacheEntry<number>>();
    putCache(cache, "a", 1, 0, 2);
    putCache(cache, "b", 2, 10, 2);
    putCache(cache, "a", 3, 20, 2); // 入れ直すと末尾へ
    putCache(cache, "c", 4, 30, 2);
    assert.deepEqual([...cache.keys()], ["a", "c"]);
    putCache(cache, "d", 5, 30 + ANALYSIS_TTL_MS, 10);
    assert.deepEqual([...cache.keys()], ["d"]);
  });
});
