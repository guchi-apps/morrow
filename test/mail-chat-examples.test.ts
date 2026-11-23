import assert from "node:assert/strict";
import { test } from "node:test";

import { orderChatExamples } from "../src/lib/mail/chat-examples.ts";

test("提案が無ければ既定の並びで、重複しない", () => {
  const list = orderChatExamples([]);
  assert.equal(list[0], "支払期限はいつ？");
  assert.equal(new Set(list).size, list.length);
  assert.ok(list.length >= 5);
});

test("提案の種類に合う候補が先頭へ来る", () => {
  const list = orderChatExamples(["event"]);
  assert.equal(list[0], "予定にして");
  assert.equal(list.length, orderChatExamples([]).length);
});

test("知らない種類は無視する", () => {
  assert.deepEqual(orderChatExamples(["unknown"]), orderChatExamples([]));
});
