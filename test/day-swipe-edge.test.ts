import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { pullFromEdge, scrollEdge } from "../src/components/dashboard/day-swipe-edge.ts";

describe("scrollEdge", () => {
  it("端と途中と、動かない枠を見分ける", () => {
    assert.equal(scrollEdge(0, 300, 1104), "start");
    assert.equal(scrollEdge(500, 300, 1104), null);
    assert.equal(scrollEdge(804, 300, 1104), "end");
    assert.equal(scrollEdge(803.5, 300, 1104), "end");
    assert.equal(scrollEdge(0, 300, 300), null);
  });
});

describe("pullFromEdge", () => {
  it("端から離れている間は0で、起点も持たない", () => {
    assert.deepEqual(pullFromEdge(null, 200, 100), { dx: 0, origin: null });
  });
  it("端に着いた最初の動きは起点を決めるだけ", () => {
    assert.deepEqual(pullFromEdge("end", 200, null), { dx: 0, origin: 200 });
  });
  it("右端では左へ引いたぶんだけ、左端では右へ引いたぶんだけを数える", () => {
    assert.deepEqual(pullFromEdge("end", 150, 200), { dx: -50, origin: 200 });
    assert.deepEqual(pullFromEdge("start", 260, 200), { dx: 60, origin: 200 });
  });
  it("逆向きは枠の中へ戻るスクロールなので0にして起点を取り直す", () => {
    assert.deepEqual(pullFromEdge("end", 230, 200), { dx: 0, origin: 230 });
    assert.deepEqual(pullFromEdge("start", 170, 200), { dx: 0, origin: 170 });
  });
  it("引いたあと元の位置まで戻すと0に戻る（離しても移らない）", () => {
    assert.equal(pullFromEdge("end", 200, 200).dx, 0);
  });
});
