import assert from "node:assert/strict";
import { test } from "node:test";

import { ALL_DAYS_MASK, composeScheduledBody, daysToMask, isDue, maskToDays, nextScheduledLabel, scheduledDedupeKey, sortSchedules } from "../src/lib/scheduled-push-rule.ts";

// 2026-09-25は金曜。日本時間で指定する。
const at = (time: string) => new Date(`2026-09-25T${time}:00+09:00`);
const created = new Date("2026-09-01T00:00:00+09:00");
const friday7 = { daysMask: daysToMask([5]), hour: 7, minute: 30, createdAt: created };

test("曜日と時刻の境目", () => {
  assert.equal(isDue(friday7, at("07:29")), false);
  assert.equal(isDue(friday7, at("07:30")), true);
  assert.equal(isDue(friday7, at("10:30")), true);
  assert.equal(isDue(friday7, at("10:31")), false, "猶予3時間を過ぎたら送らない");
  assert.equal(isDue({ ...friday7, daysMask: daysToMask([1, 2]) }, at("08:00")), false);
});

test("登録より前の時刻の分は送らない", () => {
  assert.equal(isDue({ ...friday7, createdAt: at("08:00") }, at("08:30")), false);
  assert.equal(isDue({ ...friday7, createdAt: at("07:00") }, at("08:30")), true);
});

test("日本時間の0時台でも曜日がずれない", () => {
  const sat = { daysMask: daysToMask([6]), hour: 0, minute: 0, createdAt: created };
  assert.equal(isDue(sat, new Date("2026-09-25T15:30:00Z")), true); // JST 土曜0:30
});

test("曜日のビット変換と鍵と本文", () => {
  assert.deepEqual(maskToDays(daysToMask([6, 0, 3, 3, 9])), [0, 3, 6]);
  assert.equal(scheduledDedupeKey("abc", at("07:30")), "2026-09-25:abc");
  assert.equal(composeScheduledBody(["a", "b", "c", "d"]), "・a\n・b\n・c");
});

test("設定の一覧は時刻の昇順で、同時刻はIDの順", () => {
  const rows = [
    { id: "c", hour: 21, minute: 30 },
    { id: "b", hour: 7, minute: 30 },
    { id: "z", hour: 7, minute: 0 },
    { id: "a", hour: 7, minute: 30 },
    { id: "d", hour: 0, minute: 0 },
  ];
  assert.deepEqual(sortSchedules(rows).map((row) => row.id), ["d", "z", "a", "b", "c"]);
  assert.equal(rows[0].id, "c", "元の配列は変えない");
});

test("次に迎える定時のラベル（24時間以内は時刻だけ、先は曜日つき）", () => {
  const row = (daysMask: number, hour: number, minute: number, enabled = true) => ({ daysMask, hour, minute, enabled });
  // 2026-11-17は火曜（日本時間の10:00 = 01:00Z）
  const now = new Date("2026-11-17T01:00:00Z");
  assert.equal(nextScheduledLabel([row(ALL_DAYS_MASK, 18, 0)], now), "18:00");
  // 今日の時刻を過ぎていれば明日の同時刻（ちょうど24時間後は時刻のみ）
  assert.equal(nextScheduledLabel([row(ALL_DAYS_MASK, 10, 0)], now), "10:00");
  assert.equal(nextScheduledLabel([row(ALL_DAYS_MASK, 6, 30)], now), "06:30");
  // 24時間より先は曜日つき（水曜のみ・11:00 → 25時間後）
  assert.equal(nextScheduledLabel([row(daysToMask([3]), 11, 0)], now), "水 11:00");
  // 一番近いものを選び、無効な行は無視する
  assert.equal(nextScheduledLabel([row(ALL_DAYS_MASK, 18, 0), row(ALL_DAYS_MASK, 12, 0), row(ALL_DAYS_MASK, 11, 0, false)], now), "12:00");
  assert.equal(nextScheduledLabel([row(ALL_DAYS_MASK, 11, 0, false)], now), null);
  assert.equal(nextScheduledLabel([], now), null);
});
