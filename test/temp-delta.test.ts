import assert from "node:assert/strict";
import { test } from "node:test";

import { tempDelta } from "@/lib/dashboard/temp-delta";

test("高い・低い・同じを符号と向きで返す", () => {
  assert.deepEqual(tempDelta(20.1, 16.9), { text: "(＋3.2)", direction: "up" });
  assert.deepEqual(tempDelta(11.3, 12.3), { text: "(−1.0)", direction: "down" });
  assert.deepEqual(tempDelta(12, 12), { text: "(±0.0)", direction: "same" });
});

test("表示と同じ小数1桁どうしの差にする", () => {
  // 20.14 → 20.1、16.86 → 16.9 なので差は 3.2（生の差 3.28 → 3.3 にならない）
  assert.deepEqual(tempDelta(20.14, 16.86), { text: "(＋3.2)", direction: "up" });
  // 丸めると同じ値になる差は ±0.0
  assert.deepEqual(tempDelta(12.01, 11.99), { text: "(±0.0)", direction: "same" });
});

test("片方が無い・数でない値なら差を出さない", () => {
  assert.equal(tempDelta(null, 10), null);
  assert.equal(tempDelta(10, null), null);
  assert.equal(tempDelta(Number.NaN, 10), null);
  assert.equal(tempDelta(10, Number.POSITIVE_INFINITY), null);
});
