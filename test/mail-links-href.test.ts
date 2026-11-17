import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { linkAppUrl, taskOpenUrl, taskOpensInApp } from "../src/lib/mail/app-links.ts";

describe("linkAppUrl（#914）", () => {
  it("予定は日付付きでカレンダーを開く", () => {
    assert.equal(linkAppUrl("event", "2026-11-09"), "https://dayspan.gucchii.com/calendar?date=2026-11-09");
  });
  it("日付が無い・形が違う予定は従来の/calendar", () => {
    assert.equal(linkAppUrl("event", null), "https://dayspan.gucchii.com/calendar");
    assert.equal(linkAppUrl("event", "11/9&x=1"), "https://dayspan.gucchii.com/calendar");
  });
  it("日付のあるタスクはアプリで開けるカレンダーへ渡す（#940）", () => {
    assert.equal(linkAppUrl("task", "2026-05-31"), "https://dayspan.gucchii.com/calendar?date=2026-05-31");
  });
  it("日付の無い・形が違うタスクは/tasks", () => {
    assert.equal(linkAppUrl("task", null), "https://dayspan.gucchii.com/tasks");
    assert.equal(linkAppUrl("task", "5/31"), "https://dayspan.gucchii.com/tasks");
  });
});

describe("taskOpenUrl（#1022）", () => {
  it("予定日があればその日、無ければ期限の日のカレンダーを開く", () => {
    assert.equal(taskOpenUrl({ planned: "2026-11-17", due: "2026-11-20" }), "https://dayspan.gucchii.com/calendar?date=2026-11-17");
    assert.equal(taskOpenUrl({ planned: null, due: "2026-11-20" }), "https://dayspan.gucchii.com/calendar?date=2026-11-20");
  });
  it("予定日が不正なら期限へ、どちらも無ければタスク一覧", () => {
    assert.equal(taskOpenUrl({ planned: "11/17", due: "2026-11-20" }), "https://dayspan.gucchii.com/calendar?date=2026-11-20");
    assert.equal(taskOpenUrl({}), "https://dayspan.gucchii.com/tasks");
  });
});

describe("taskOpensInApp（#1030）", () => {
  it("日付があればアプリで開き、無ければ（/tasksでSafari）開かない", () => {
    assert.equal(taskOpensInApp({ planned: "2026-11-17" }), true);
    assert.equal(taskOpensInApp({ due: "2026-11-20" }), true);
    assert.equal(taskOpensInApp({}), false);
    assert.equal(taskOpensInApp({ planned: "11/17", due: null }), false);
  });
  it("案内の判定は遷移先（taskOpenUrl）と一致する", () => {
    const cases = [{}, { due: "2026-11-20" }, { planned: "11/17", due: "2026-11-20" }, { planned: "11/17", due: "x" }, { planned: "2026-11-17", due: null }];
    for (const c of cases) assert.equal(taskOpensInApp(c), taskOpenUrl(c).includes("/calendar?date="));
  });
});
