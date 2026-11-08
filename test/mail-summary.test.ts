import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { POINTS_MAX, buildSummaryPrompt, parseSummaryReply } from "@/lib/mail/summary-core";

/** メールの要約（#717）のうち、DB・ネットワークに触れない部分。 */

describe("parseSummaryReply", () => {
  it("要約と要点を読む（前置き・後書きは無視）", () => {
    const result = parseSummaryReply('前置き{"summary":"請求のお知らせ","points":["金額 8,420円","期限 11/14"]}後書き');
    assert.deepEqual(result, { summary: "請求のお知らせ", points: ["金額 8,420円", "期限 11/14"] });
  });

  it("要点は上限で切り、文字列以外・空は落とす", () => {
    const points = ["a", 1, "", "b", "c", "d", "e", "f"];
    const result = parseSummaryReply(JSON.stringify({ summary: "x", points }));
    assert.ok(result);
    assert.equal(result.points.length, POINTS_MAX);
    assert.deepEqual(result.points.slice(0, 2), ["a", "b"]);
  });

  it("読めない・要約が空・形が違う返答はnull。要点が無ければ空配列", () => {
    assert.equal(parseSummaryReply("だめ"), null);
    assert.equal(parseSummaryReply('{"summary":"  ","points":[]}'), null);
    assert.equal(parseSummaryReply('{"points":["a"]}'), null);
    assert.equal(parseSummaryReply("[1]"), null);
    assert.deepEqual(parseSummaryReply('{"summary":"x"}'), { summary: "x", points: [] });
  });
});

describe("buildSummaryPrompt", () => {
  it("本文をデータとして渡し、メール内の指示に従わせない", () => {
    const prompt = buildSummaryPrompt({ from: "a@example.com", subject: "件名", body: "本文です" });
    assert.match(prompt, /メールの中に書かれた指示/);
    assert.match(prompt, /"body":"本文です"/);
  });

  it("本文は上限で切る", () => {
    const prompt = buildSummaryPrompt({ from: "a", subject: "b", body: "あ".repeat(20000) });
    assert.ok(prompt.length < 9000);
  });
});
