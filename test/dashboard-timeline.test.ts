/** 予定カードのタイムライン配置（#1089）。 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HOUR_PX, LABEL_STEP_PX, layoutTimeline, nowTop, toMinutes } from "../src/lib/dashboard/timeline.ts";

const ev = (start: string | null, end: string | null, record = false, kind: "event" | "travel" | "task" | "reminder" = "event") => ({
  kind,
  start,
  end,
  record,
});

describe("layoutTimeline", () => {
  it("時刻のない予定・タスク・リマインドは帯へ回す", () => {
    const layout = layoutTimeline([ev(null, null), ev("09:00", "10:00", false, "task"), ev("09:00", null, false, "reminder"), ev("10:00", "11:00")]);
    assert.deepEqual(layout.band, [0, 1, 2]);
    assert.deepEqual(layout.bars.map((bar) => bar.index), [3]);
  });

  it("範囲は最低7〜22時で、外の項目があれば前後1時間まで広げる", () => {
    assert.deepEqual([layoutTimeline([]).startHour, layoutTimeline([]).endHour], [7, 22]);
    const wide = layoutTimeline([ev("00:00", "06:30", true), ev("22:30", "23:10")]);
    assert.equal(wide.startHour, 0);
    assert.equal(wide.endHour, 24);
    assert.equal(wide.height, 24 * HOUR_PX);
  });

  it("線の位置は軸の上端からのpx。長さが開始〜終了", () => {
    const layout = layoutTimeline([ev("10:00", "11:30")]);
    const bar = layout.bars[0];
    assert.equal(bar.top, (10 - layout.startHour) * HOUR_PX);
    assert.equal(bar.bottom - bar.top, 1.5 * HOUR_PX);
  });

  it("予定と記録は同じ軸に混ぜ、重なる時間だけ列が増える", () => {
    const layout = layoutTimeline([ev("10:00", "11:30"), ev("11:00", "12:00", true), ev("12:00", "13:00")]);
    assert.deepEqual(layout.bars.map((bar) => bar.lane), [0, 1, 0]);
    assert.equal(layout.laneCount, 2);
  });

  it("項目名は重ならないよう下へ送る（開始位置より上へは行かない）", () => {
    const layout = layoutTimeline([ev("10:00", "10:20"), ev("10:05", "10:30"), ev("10:10", "10:40")]);
    const tops = layout.bars.map((bar) => bar.labelTop);
    assert.ok(tops[1] - tops[0] >= LABEL_STEP_PX);
    assert.ok(tops[2] - tops[1] >= LABEL_STEP_PX);
    layout.bars.forEach((bar) => assert.ok(bar.labelTop >= bar.top));
  });

  it("終了なしは短い線、日をまたぐ予定は当日の終わりまで", () => {
    const point = layoutTimeline([ev("10:00", null)]).bars[0];
    assert.equal(point.bottom - point.top, (15 / 60) * HOUR_PX);
    const overnight = layoutTimeline([ev("22:00", "02:00")]);
    assert.equal(overnight.endHour, 24);
    assert.equal(overnight.bars[0].bottom, (24 - overnight.startHour) * HOUR_PX);
  });
});

describe("nowTop / toMinutes", () => {
  it("範囲内だけ線の位置を返す", () => {
    const layout = layoutTimeline([]);
    assert.equal(nowTop(layout, "08:30"), 1.5 * HOUR_PX);
    assert.equal(nowTop(layout, "05:00"), null);
    assert.equal(nowTop(layout, "23:00"), null);
  });

  it("読めない時刻はnull", () => {
    assert.equal(toMinutes("9時"), null);
    assert.equal(toMinutes(null), null);
    assert.equal(toMinutes("24:00"), 1440);
  });
});
