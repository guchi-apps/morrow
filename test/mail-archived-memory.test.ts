import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ARCHIVED_TTL_MS,
  addArchived,
  hideArchived,
  onlyInbox,
  pruneArchived,
  removeArchived,
} from "../src/lib/mail/archived-memory.ts";

test("追加したIDは期限内だけ残る", () => {
  const map = addArchived({}, ["a"], 1000);
  assert.deepEqual(Object.keys(pruneArchived(map, 1000 + ARCHIVED_TTL_MS - 1)), ["a"]);
  assert.deepEqual(Object.keys(pruneArchived(map, 1000 + ARCHIVED_TTL_MS)), []);
});

test("失敗・戻したIDは覚えから外れる", () => {
  const map = addArchived({}, ["a", "b"], 1000);
  assert.deepEqual(Object.keys(removeArchived(map, ["a"], 2000)), ["b"]);
});

test("受信トレイ表示のときだけ覚えにあるメールを隠す", () => {
  const rows = [{ id: "a" }, { id: "b" }];
  const map = addArchived({}, ["a"], 1000);
  assert.deepEqual(hideArchived(rows, map, true), [{ id: "b" }]);
  assert.deepEqual(hideArchived(rows, map, false), rows);
  assert.deepEqual(hideArchived(rows, pruneArchived(map, 1000 + ARCHIVED_TTL_MS), true), rows);
});

test("INBOXラベルの無い行は受信トレイから外す", () => {
  const rows = [{ labelIds: ["INBOX", "UNREAD"] }, { labelIds: ["UNREAD"] }];
  assert.equal(onlyInbox(rows).length, 1);
});
