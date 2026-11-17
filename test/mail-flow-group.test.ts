import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bulkResultText, groupHeading, isBulkKind, isRegisteredByRecord, recommendedIndex } from "@/lib/mail/flow-group";
import { registeredKeyOf, summarizeSuggestion } from "@/lib/mail/flow-summary";
import { normalizeSuggestion, type Suggestion } from "@/lib/mail/suggest-core";

const s = (kind: string, fields: Record<string, unknown>): Suggestion => {
  const suggestion = normalizeSuggestion(kind, fields);
  assert.ok(suggestion);
  return suggestion;
};

const task1 = s("task", { title: "受け取る（1点目）", planned: "2026-11-18" });
const task2 = s("task", { title: "受け取る（2点目）", planned: "2026-11-19" });
const event = s("event", { title: "来店", date: "2026-11-20" });
const payment = s("payment", { name: "参加費", amount: 3000, date: "2026-11-05" });

describe("提案をまとめて出す（#1051）", () => {
  it("見出しは件数と種類ごとの数（最初に出た順）", () => {
    assert.equal(groupHeading([task1, event, task2, payment]), "候補 4件（タスク2・予定1・家計簿1）");
  });

  it("まとめて登録できるのはタスクと予定だけ", () => {
    assert.deepEqual(
      (["task", "event", "payment", "subscription", "tracking", "link"] as const).filter(isBulkKind),
      ["task", "event"],
    );
  });

  it("おすすめの印は同じ種類の先頭の1行だけ。1件だけなら付けない指定もできる", () => {
    assert.equal(recommendedIndex([event, task1, task2], "task"), 1);
    assert.equal(recommendedIndex([task1], "task", true), -1);
    assert.equal(recommendedIndex([task1, task2], null), -1);
  });

  it("同じ種類が1行なら種類で、複数なら内容で登録済みを見る", () => {
    const cards = [task1, task2, event];
    const keys = [registeredKeyOf("task", summarizeSuggestion(task1))];
    assert.equal(isRegisteredByRecord(task1, cards, ["task"], keys), true);
    assert.equal(isRegisteredByRecord(task2, cards, ["task"], keys), false);
    assert.equal(isRegisteredByRecord(event, cards, ["event"], []), true);
  });

  it("まとめて登録の結果の文", () => {
    assert.deepEqual(bulkResultText([{ kind: "task", ok: true }, { kind: "task", ok: true }, { kind: "event", ok: true }]), { text: "3件を登録しました（タスク2・予定1）。", error: false });
    assert.deepEqual(bulkResultText([{ kind: "task", ok: true }, { kind: "event", ok: false }]), { text: "2件中1件を登録しました（タスク1）。1件は登録できませんでした。", error: true });
    assert.equal(bulkResultText([{ kind: "task", ok: false }]).error, true);
  });
});
