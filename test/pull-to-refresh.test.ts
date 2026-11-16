import assert from "node:assert/strict";
import { test } from "node:test";

import { isPullGesture, PULL_MAX, PULL_THRESHOLD, pullDistance, shouldRefresh } from "../src/components/mail/pull-to-refresh-core.ts";

test("pullDistance は上向き・0を0にし、上限で止める", () => {
  assert.equal(pullDistance(-10), 0);
  assert.equal(pullDistance(0), 0);
  assert.equal(pullDistance(40), 20);
  assert.equal(pullDistance(10000), PULL_MAX);
});

test("shouldRefresh は閾値以上だけ真", () => {
  assert.equal(shouldRefresh(PULL_THRESHOLD - 1), false);
  assert.equal(shouldRefresh(PULL_THRESHOLD), true);
});

test("isPullGesture は先頭からの縦の下向きだけ受ける", () => {
  assert.equal(isPullGesture(0, 2, 30), true);
  assert.equal(isPullGesture(5, 0, 30), false);
  assert.equal(isPullGesture(0, 40, 30), false);
  assert.equal(isPullGesture(0, 0, -30), false);
});
