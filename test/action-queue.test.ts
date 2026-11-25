import assert from "node:assert/strict";
import { test } from "node:test";

import { createPendingCounter, createRefreshGate } from "../src/components/mail/action-queue.ts";

test("結果待ちの件数は購読者へ伝わる", () => {
  const counter = createPendingCounter();
  const seen: number[] = [];
  const stop = counter.subscribe((n) => seen.push(n));
  counter.start();
  counter.start();
  counter.finish();
  stop();
  counter.finish();
  assert.deepEqual(seen, [1, 2, 1]);
  assert.equal(counter.pending(), 0);
});

test("最後の1通が失敗しても、先に成功があれば取り直しの判定が立つ", () => {
  const gate = createRefreshGate();
  gate.markSucceeded(); // a
  assert.equal(gate.shouldRefresh(3), false);
  gate.markSucceeded(); // b
  assert.equal(gate.shouldRefresh(2), false);
  // c は失敗（markSucceeded なし）。列の最後なので判定が立つ
  assert.equal(gate.shouldRefresh(1), true);
  // 印は戻る
  assert.equal(gate.shouldRefresh(1), false);
});

test("成功が1通もなければ取り直さない", () => {
  const gate = createRefreshGate();
  assert.equal(gate.shouldRefresh(1), false);
});
