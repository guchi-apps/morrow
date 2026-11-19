import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calendarColor } from "../src/lib/dashboard/calendar-color.ts";

describe("calendarColor", () => {
  it("活動記録は茶色、移動は専用色", () => {
    assert.equal(calendarColor({ kind: "event", record: true, note: "活動記録" }), "var(--cal-record)");
    assert.equal(calendarColor({ kind: "travel", record: false, note: null }), "var(--cal-travel)");
  });
  it("同じカレンダー名は常に同じ色", () => {
    const a = calendarColor({ kind: "event", record: false, note: "仕事" });
    assert.equal(a, calendarColor({ kind: "event", record: false, note: "仕事" }));
    assert.match(a, /^var\(--cal-[1-5]\)$/);
  });
});
