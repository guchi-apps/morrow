import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays, startOfDay, startOfMonth } from "../src/lib/usage.ts";

test("日本時間の朝9時より前でも、日本時間の同じ日の0時へ丸める", () => {
  // 2026-09-30 23:30 UTC = 2026-10-01 08:30 JST
  const at = new Date("2026-09-30T23:30:00Z");
  assert.equal(startOfDay(at).toISOString(), "2026-09-30T15:00:00.000Z");
  assert.equal(startOfMonth(at).toISOString(), "2026-09-30T15:00:00.000Z");
});

test("月末のJSTはその月に入る", () => {
  // 2026-10-31 16:00 UTC = 2026-11-01 01:00 JST
  assert.equal(startOfMonth(new Date("2026-10-31T16:00:00Z")).toISOString(), "2026-10-31T15:00:00.000Z");
  assert.equal(startOfMonth(new Date("2026-10-31T14:59:00Z")).toISOString(), "2026-09-30T15:00:00.000Z");
});

test("addDaysは日本時間の0時を保つ", () => {
  const base = startOfDay(new Date("2026-10-05T00:00:00Z"));
  assert.equal(addDays(base, -6).toISOString(), "2026-09-28T15:00:00.000Z");
});
