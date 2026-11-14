import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { linkAppUrl } from "../src/lib/mail/app-links.ts";

describe("linkAppUrl（#914）", () => {
  it("予定は日付付きでカレンダーを開く", () => {
    assert.equal(linkAppUrl("event", "2026-11-09"), "https://dayspan.gucchii.com/calendar?date=2026-11-09");
  });
  it("日付が無い・形が違う予定は従来の/calendar", () => {
    assert.equal(linkAppUrl("event", null), "https://dayspan.gucchii.com/calendar");
    assert.equal(linkAppUrl("event", "11/9&x=1"), "https://dayspan.gucchii.com/calendar");
  });
  it("タスクは日付を付けない", () => {
    assert.equal(linkAppUrl("task", "2026-05-31"), "https://dayspan.gucchii.com/tasks");
  });
});
