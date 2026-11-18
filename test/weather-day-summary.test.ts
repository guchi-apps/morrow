import assert from "node:assert/strict";
import { test } from "node:test";

import { dayAtColumn, summarizeDay } from "../src/lib/weather/day-summary.ts";

const day = (date: string, max: number | null, min: number | null) => ({ date, code: 61, max, min, pop: 80 });

test("前日比は天気カードと同じ表記（小数1桁）", () => {
  const meta = { date: "2026-11-13", label: "11月13日", condition: "雨" };
  const got = summarizeDay(day("2026-11-13", 19.4, 11), day("2026-11-12", 16.2, 12), meta);
  assert.equal(got.maxDiff, "(＋3.2)");
  assert.equal(got.minDiff, "(−1.0)");
});

test("前日が無いときは差を出さず、予報が無い日は「予報なし」", () => {
  const meta = { date: "2026-11-12", label: "11月12日", condition: "雨" };
  const first = summarizeDay(day("2026-11-12", 15, 8), null, meta);
  assert.equal(first.maxDiff, null);
  assert.equal(first.condition, "雨");
  const none = summarizeDay(null, null, meta);
  assert.equal(none.condition, "予報なし");
  assert.equal(none.max, null);
});

test("列の位置から日を引く（24列ごと・範囲外は端）", () => {
  const days = ["a", "b", "c"];
  assert.equal(dayAtColumn(days, 0), "a");
  assert.equal(dayAtColumn(days, 23), "a");
  assert.equal(dayAtColumn(days, 24), "b");
  assert.equal(dayAtColumn(days, -5), "a");
  assert.equal(dayAtColumn(days, 999), "c");
});
