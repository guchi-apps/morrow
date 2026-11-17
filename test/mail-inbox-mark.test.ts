import assert from "node:assert/strict";
import { test } from "node:test";

import { dimArchivedRows, isInboxRow, searchViewFor, showInboxMark } from "../src/lib/mail/inbox-mark.ts";

test("目印を出すのは「すべて」表示だけ", () => {
  assert.equal(showInboxMark("all"), true);
  for (const view of ["inbox", "unread", "trash", ""]) assert.equal(showInboxMark(view), false);
});

test("INBOXラベルがあれば受信トレイの行", () => {
  assert.equal(isInboxRow(["UNREAD", "INBOX"]), true);
  assert.equal(isInboxRow(["CATEGORY_UPDATES"]), false);
  assert.equal(isInboxRow([]), false);
});

test("検索結果はゴミ箱以外で目印を出し、アーカイブ済みを淡くしない（#1054）", () => {
  for (const view of ["inbox", "unread", "all"]) {
    assert.equal(showInboxMark(view, true), true);
    assert.equal(dimArchivedRows(view, true), false);
  }
  assert.equal(showInboxMark("trash", true), false);
  assert.equal(dimArchivedRows("all"), true);
  assert.equal(dimArchivedRows("inbox"), false);
});

test("検索の対象はゴミ箱だけそのまま、ほかは「すべて」", () => {
  assert.equal(searchViewFor("trash"), "trash");
  for (const view of ["inbox", "unread", "all"] as const) assert.equal(searchViewFor(view), "all");
});
