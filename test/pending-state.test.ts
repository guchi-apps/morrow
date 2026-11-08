import assert from "node:assert/strict";
import { test } from "node:test";

import { PENDING_STATE_TTL_MS, isPendingStateFresh } from "@/lib/mcp/pending-state";

const now = Date.UTC(2026, 9, 5, 0, 0, 0);

test("期限内のstateは使える", () => {
  assert.equal(isPendingStateFresh(new Date(now - 1000), now), true);
  assert.equal(isPendingStateFresh(new Date(now - PENDING_STATE_TTL_MS), now), true);
});

test("期限切れ・開始時刻なし・未来の時刻は使えない", () => {
  assert.equal(isPendingStateFresh(new Date(now - PENDING_STATE_TTL_MS - 1), now), false);
  assert.equal(isPendingStateFresh(null, now), false);
  assert.equal(isPendingStateFresh(new Date(now + 1000), now), false);
});
