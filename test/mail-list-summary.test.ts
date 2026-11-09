import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LIST_SUMMARY_BATCH,
  LIST_SUMMARY_MAX_LEN,
  LIST_SUMMARY_RETRY_MS,
  buildListSummaryPrompt,
  inRetryWait,
  parseListSummaryReply,
  selectMissing,
} from "../src/lib/mail/list-summary-core.ts";

describe("一覧の要約（#851）", () => {
  it("返答からkey→要約を読み、知らないkey・空・重複を落とす", () => {
    const map = parseListSummaryReply('前置き [{"key":"m1","summary":"A"},{"key":"m9","summary":"X"},{"key":"m2","summary":" "},{"key":"m1","summary":"B"}] 後書き', ["m1", "m2"]);
    assert.deepEqual([...map!], [["m1", "A"]]);
  });
  it("読めない返答はnull、長い要約は切る", () => {
    assert.equal(parseListSummaryReply("なし", ["m1"]), null);
    assert.equal(parseListSummaryReply("[壊れ", ["m1"]), null);
    const long = "あ".repeat(500);
    const map = parseListSummaryReply(JSON.stringify([{ key: "m1", summary: long }]), ["m1"]);
    assert.ok(map!.get("m1")!.length <= LIST_SUMMARY_MAX_LEN + 1);
  });
  it("要約の無いIDだけを上限まで選ぶ", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "a"];
    assert.deepEqual(selectMissing(ids, new Set(["b"])), ["a", "c", "d", "e", "f"]);
    assert.equal(selectMissing(ids, new Set()).length, LIST_SUMMARY_BATCH);
  });
  it("プロンプトは本文をデータとして1行JSONで渡す", () => {
    const prompt = buildListSummaryPrompt([{ key: "m1", from: "a", subject: "s\n", body: "本文\n2行目" }]);
    assert.match(prompt, /"key":"m1"/);
    assert.ok(!prompt.includes("本文\n2行目"));
  });
  it("失敗後は15分待つ", () => {
    assert.equal(inRetryWait(undefined, 1000), false);
    assert.equal(inRetryWait(0, LIST_SUMMARY_RETRY_MS - 1), true);
    assert.equal(inRetryWait(0, LIST_SUMMARY_RETRY_MS), false);
  });
});
