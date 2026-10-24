import assert from "node:assert/strict";
import test from "node:test";

import {
  addDays,
  cardDayName,
  DAY_RANGE,
  dayDiff,
  dayHref,
  relativeDayName,
  resolveDayOffset,
} from "../src/lib/dashboard/day-offset.ts";

const TODAY = "2026-10-22";

test("日付の足し引きは月・年をまたいでも暦どおり", () => {
  assert.equal(addDays(TODAY, 1), "2026-10-23");
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(addDays("2027-01-01", -1), "2026-12-31");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(dayDiff(TODAY, "2026-10-29"), 7);
  assert.equal(dayDiff(TODAY, "2026-10-15"), -7);
});

test("読めない・実在しない日付は空文字・null", () => {
  assert.equal(addDays("2026-02-30", 1), "");
  assert.equal(addDays("abc", 1), "");
  assert.equal(dayDiff(TODAY, "2026-13-01"), null);
});

test("URLの d は無い・読めないなら今日、範囲外は端へ丸める", () => {
  assert.equal(resolveDayOffset(TODAY, undefined), 0);
  assert.equal(resolveDayOffset(TODAY, ""), 0);
  assert.equal(resolveDayOffset(TODAY, "tomorrow"), 0);
  assert.equal(resolveDayOffset(TODAY, "2026-10-23"), 1);
  assert.equal(resolveDayOffset(TODAY, "2026-10-21"), -1);
  assert.equal(resolveDayOffset(TODAY, "2027-01-01"), DAY_RANGE);
  assert.equal(resolveDayOffset(TODAY, "2026-01-01"), -DAY_RANGE);
  assert.equal(resolveDayOffset(TODAY, ["2026-10-24", "2026-10-25"]), 2);
});

test("今日を開くパスは / のまま（通知の遷移先と揃える）", () => {
  assert.equal(dayHref(TODAY, 0), "/");
  assert.equal(dayHref(TODAY, 1), "/?d=2026-10-23");
  assert.equal(dayHref(TODAY, -3), "/?d=2026-10-19");
});

test("見出しの呼び方", () => {
  assert.equal(relativeDayName(-1), "きのう");
  assert.equal(relativeDayName(1), "明日");
  assert.equal(relativeDayName(3), null);
  assert.equal(cardDayName("2026-10-22", 0), "今日");
  assert.equal(cardDayName("2026-10-23", 1), "明日");
  assert.equal(cardDayName("2026-10-25", 3), "10月25日");
  assert.equal(cardDayName("2026-10-02", -20), "10月2日");
});
