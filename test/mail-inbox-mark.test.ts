import assert from "node:assert/strict";
import { test } from "node:test";

import { isInboxRow, showInboxMark } from "../src/lib/mail/inbox-mark.ts";

test("目印を出すのは「すべて」表示だけ", () => {
  assert.equal(showInboxMark("all"), true);
  for (const view of ["inbox", "unread", "trash", ""]) assert.equal(showInboxMark(view), false);
});

test("INBOXラベルがあれば受信トレイの行", () => {
  assert.equal(isInboxRow(["UNREAD", "INBOX"]), true);
  assert.equal(isInboxRow(["CATEGORY_UPDATES"]), false);
  assert.equal(isInboxRow([]), false);
});
