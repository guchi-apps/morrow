import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sanitizeLinkSuggestions } from "@/lib/mail/analyze-core";
import { mergeTaskCandidates, nextTaskCursor, type LinkCandidate } from "@/lib/mail/link-core";
import { normalizeSuggestion, toolCallFor } from "@/lib/mail/suggest-core";
import { appendTrackingMemo, memoHasTrackingNumber, parseTaskSnapshot, TASK_MEMO_MAX, trackingMemoLines } from "@/lib/mail/tracking-task";

const tracking = { carrier: "sagawa", number: "370051273292" } as const;
const mail = { messageId: "main~1", subject: "出荷のお知らせ", from: "shop@example.com", receivedAt: null };

describe("追跡番号をタスクのメモに残す（#1211）", () => {
  it("今のメモを残して末尾へ足す", () => {
    const result = appendTrackingMemo("注文番号1。\n", tracking);
    assert.deepEqual(result, {
      status: "append",
      memo: "注文番号1。\n追跡番号: 佐川急便 370051273292\n追跡ページ: https://k2k.sagawa-exp.co.jp/p/web/okurijosearch.do?okurijoNo=370051273292",
    });
    assert.equal(trackingMemoLines(tracking).length, 2);
    const empty = appendTrackingMemo(null, tracking);
    assert.ok(empty.status === "append" && empty.memo.startsWith("追跡番号:"));
  });

  it("同じ番号があれば足さない（区切りの違いは同じ番号。長い番号の一部は数えない）", () => {
    assert.equal(appendTrackingMemo("伝票 3700-5127-3292", tracking).status, "duplicate");
    assert.equal(memoHasTrackingNumber("伝票 ３７００５１２７３２９２", tracking.number), true);
    assert.equal(memoHasTrackingNumber("番号 93700512732920", tracking.number), false);
  });

  it("上限を超えるときは書かない", () => {
    assert.equal(appendTrackingMemo("あ".repeat(TASK_MEMO_MAX - 10), tracking).status, "too_long");
  });

  it("タスクの応答を読む。失敗・memoの無い応答はnull", () => {
    // aide_get_task の実応答の形（2026-11-27に読み取りで確認）
    const task = { id: "t1", title: "受け取る", status: "open", due: null, planned: "2026-12-01", memo: null, version: "2026-11-22T11:23:00.000Z" };
    assert.deepEqual(parseTaskSnapshot({ task }), task);
    assert.equal(parseTaskSnapshot({ ok: false, kind: "conflict", reason: "HTTP 409" }), null);
    assert.equal(parseTaskSnapshot({ task: { ...task, memo: undefined } }), null);
  });

  it("新しいタスクのメモに番号を入れ、冪等キーを分ける", () => {
    const fields = { title: "荷物を受け取る", due: null, dueTime: null, planned: null, plannedTime: null, memo: "" };
    const plain = toolCallFor(normalizeSuggestion("task", fields)!, mail, "u");
    const withNumber = toolCallFor(normalizeSuggestion("task", { ...fields, tracking })!, mail, "u");
    assert.ok(plain.ok && withNumber.ok);
    assert.match(String(withNumber.args.memo), /追跡番号: 佐川急便 370051273292\n追跡ページ: https:/);
    assert.doesNotMatch(String(plain.args.memo), /追跡番号/);
    assert.notEqual(plain.args.idempotencyKey, withNumber.args.idempotencyKey);
    // 桁の合わない番号は載せない
    const bad = normalizeSuggestion("task", { ...fields, tracking: { carrier: "sagawa", number: "1" } });
    assert.ok(bad?.kind === "task" && bad.fields.tracking === undefined);
  });

  it("追跡の提案が指すタスクは、候補にあるものだけ残す", () => {
    const candidates: LinkCandidate[] = [{ kind: "task", targetId: "t1", calendarId: null, title: "受け取る", dateText: null, time: null }];
    const reply = (taskId: string) => JSON.stringify({ suggestions: [{ kind: "tracking", fields: { ...tracking, taskId } }] });
    assert.equal(JSON.parse(sanitizeLinkSuggestions(reply("t1"), candidates)).suggestions[0].fields.taskId, "t1");
    assert.equal(JSON.parse(sanitizeLinkSuggestions(reply("zzz"), candidates)).suggestions[0].fields.taskId, undefined);
  });

  it("期限・予定日・日付なしの一覧を1つにまとめ、続きを辿る", () => {
    const merged = mergeTaskCandidates([
      { tasks: [{ id: "a", title: "期限あり", due: "2027-01-09", planned: "2026-12-01" }] },
      { tasks: [{ id: "a", title: "期限あり", due: "2027-01-09" }, { id: "b", title: "予定日だけ", due: null, planned: "2026-12-01" }] },
      { tasks: [{ id: "c", title: "日付なし", due: null, planned: null }] },
    ]);
    assert.deepEqual(merged.map((t) => t.targetId), ["b", "a", "c"]);
    assert.equal(nextTaskCursor({ tasks: [], hasMore: true, nextCursor: "s:1" }), "s:1");
    assert.equal(nextTaskCursor({ hasMore: false, nextCursor: "s:1" }), null);
  });
});
