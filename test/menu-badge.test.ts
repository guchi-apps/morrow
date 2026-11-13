import assert from "node:assert/strict";
import test from "node:test";

import { badgeText } from "../src/components/chat/badge-text.ts";

test("badgeText: 件数の表示（#877）", () => {
  assert.equal(badgeText(3), "3");
  assert.equal(badgeText(99), "99");
  assert.equal(badgeText(100), "99+");
  assert.equal(badgeText(20, true), "20+");
  assert.equal(badgeText(150, true), "99+");
});
