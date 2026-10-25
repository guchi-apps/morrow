/** 予定カードの行を、これから・終わった予定・記録に分ける判定（#626）。 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { schedulePhase } from "../src/lib/dashboard/schedule-phase.ts";

const event = (start: string | null, end: string | null, record = false) => ({
  kind: "event" as const,
  start,
  end,
  record,
});

describe("schedulePhase", () => {
  it("記録は時刻や日のずれによらず記録", () => {
    assert.equal(
      schedulePhase(event("20:44", "20:55", true), "09:00", 0),
      "record",
    );
    assert.equal(
      schedulePhase(event("20:44", "20:55", true), "23:00", -1),
      "record",
    );
  });

  it("今日は終了時刻が現在より前なら終わった予定、現在と同じ・後ならこれから", () => {
    assert.equal(schedulePhase(event("09:30", "10:15"), "15:00", 0), "done");
    assert.equal(
      schedulePhase(event("14:00", "15:00"), "15:00", 0),
      "upcoming",
    );
    assert.equal(
      schedulePhase(event("13:00", "16:00"), "15:00", 0),
      "upcoming",
    );
    assert.equal(
      schedulePhase(event("18:30", "19:30"), "15:00", 0),
      "upcoming",
    );
  });

  it("終了時刻が無ければ開始時刻で見る", () => {
    assert.equal(schedulePhase(event("09:30", null), "15:00", 0), "done");
    assert.equal(schedulePhase(event("16:00", null), "15:00", 0), "upcoming");
  });

  it("前の日は全部終わった予定、後の日は全部これから", () => {
    assert.equal(schedulePhase(event("23:00", "23:30"), "00:00", -1), "done");
    assert.equal(
      schedulePhase(event("00:10", "00:20"), "23:59", 1),
      "upcoming",
    );
  });

  it("時刻の無い予定・タスク・リマインドは分けない", () => {
    assert.equal(schedulePhase(event(null, null), "15:00", -1), "upcoming");
    assert.equal(
      schedulePhase(
        { kind: "task", start: "09:00", end: null, record: false },
        "15:00",
        0,
      ),
      "upcoming",
    );
    assert.equal(
      schedulePhase(
        { kind: "reminder", start: "09:00", end: null, record: false },
        "15:00",
        -1,
      ),
      "upcoming",
    );
  });

  it("移動も予定と同じに扱う", () => {
    assert.equal(
      schedulePhase(
        { kind: "travel", start: "06:42", end: "07:09", record: false },
        "15:00",
        0,
      ),
      "done",
    );
  });
});
