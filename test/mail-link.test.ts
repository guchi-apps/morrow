import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createdIdFrom,
  findCreatedEvent,
  findCreatedTask,
  linkKey,
  mailBadgeLabel,
  normalizeLinkTarget,
  parseEventCandidates,
  parseTaskCandidates,
} from "@/lib/mail/link-core";

/** メールと予定・タスクの紐づけ（#834）のうち、DB・ネットワークに触れない部分。 */

describe("normalizeLinkTarget", () => {
  it("予定はid・calendarId・題名が要る", () => {
    const ok = normalizeLinkTarget({ kind: "event", targetId: "ev1", calendarId: "cal1", title: " 訪問\n 13:00 ", dateText: "2026-11-09" });
    assert.deepEqual(ok, { kind: "event", targetId: "ev1", calendarId: "cal1", title: "訪問 13:00", dateText: "2026-11-09" });
    assert.equal(normalizeLinkTarget({ kind: "event", targetId: "ev1", title: "x" }), null);
  });
  it("タスクはcalendarIdを持たない", () => {
    const ok = normalizeLinkTarget({ kind: "task", targetId: "t1", calendarId: "ignored", title: "精算" });
    assert.equal(ok?.calendarId, null);
  });
  it("外から来た不正な値は読まない", () => {
    assert.equal(normalizeLinkTarget(null), null);
    assert.equal(normalizeLinkTarget({ kind: "mail", targetId: "x", title: "x" }), null);
    assert.equal(normalizeLinkTarget({ kind: "task", targetId: "a b", title: "x" }), null);
    assert.equal(normalizeLinkTarget({ kind: "task", targetId: "x".repeat(121), title: "x" }), null);
    assert.equal(normalizeLinkTarget({ kind: "task", targetId: "t", title: "  " }), null);
    assert.equal(normalizeLinkTarget({ kind: "task", targetId: "t", title: "x", dateText: "11/9" })?.dateText, null);
  });
});

const schedule = {
  days: [
    {
      date: "2026-11-09",
      events: [
        { id: "e1", calendarId: "c1", title: "訪問", startTime: "13:00", endTime: "14:00", allDay: false, calendarName: "仕事" },
        { id: "e2", calendarId: "c1", title: "睡眠", startTime: "00:00", endTime: "07:00", calendarName: "活動記録" },
        { id: "e3", calendarId: "c1", title: "中止", startTime: "10:00", endTime: "11:00", outcome: "CANCELED" },
        { title: "idなし", calendarId: "c1" },
      ],
    },
    { date: "2026-11-10", events: [{ id: "e4", calendarId: "c2", title: "終日", allDay: true }] },
  ],
};

describe("parseEventCandidates", () => {
  it("複数日から集め、活動記録・中止・idなしは除く", () => {
    const items = parseEventCandidates(schedule);
    assert.deepEqual(items.map((i) => [i.targetId, i.dateText, i.time]), [["e1", "2026-11-09", "13:00"], ["e4", "2026-11-10", null]]);
  });
  it("未設定・形違いは空", () => {
    assert.deepEqual(parseEventCandidates({ configured: false }), []);
    assert.deepEqual(parseEventCandidates("x"), []);
  });
});

describe("parseTaskCandidates", () => {
  it("tasks / items のどちらでも読み、期限を日付にする", () => {
    const a = parseTaskCandidates({ tasks: [{ taskId: "t1", title: "精算", due: "2026-11-12" }, { id: 7, title: "予定日だけ", planned: "2026-11-13" }, { title: "idなし" }] });
    assert.deepEqual(a.map((t) => [t.targetId, t.dateText]), [["t1", "2026-11-12"], ["7", "2026-11-13"]]);
    assert.equal(parseTaskCandidates({ items: [{ taskId: "t2", title: "x" }] }).length, 1);
  });
});

describe("createdIdFrom", () => {
  it("作成の応答のidを読む", () => {
    assert.deepEqual(createdIdFrom("task", { task: { taskId: "t9" } }), { targetId: "t9", calendarId: null });
    assert.deepEqual(createdIdFrom("event", { event: { id: "e9", calendarId: "c9" } }), { targetId: "e9", calendarId: "c9" });
  });
  it("予定はcalendarIdが無ければ採らない・idが無ければnull", () => {
    assert.equal(createdIdFrom("event", { id: "e9" }), null);
    assert.equal(createdIdFrom("task", { ok: true }), null);
  });
});

describe("findCreatedEvent / findCreatedTask", () => {
  it("題名・時刻が一致する1件だけ採る", () => {
    const day = { days: [{ events: [{ id: "e1", calendarId: "c1", title: "とき313号", startTime: "09:28", endTime: "11:16" }] }] };
    assert.deepEqual(findCreatedEvent(day, { title: "とき313号", startTime: "09:28", endTime: "11:16" }), { targetId: "e1", calendarId: "c1" });
    assert.equal(findCreatedEvent(day, { title: "別", startTime: "09:28", endTime: "11:16" }), null);
  });
  it("同じ題名・時刻が2件あれば決められないのでnull", () => {
    const e = { id: "e", calendarId: "c", title: "A", startTime: "09:00", endTime: "10:00" };
    assert.equal(findCreatedEvent({ days: [{ events: [e, { ...e, id: "f" }] }] }, { title: "A", startTime: "09:00", endTime: "10:00" }), null);
  });
  it("タスクは題名（と期限）の一致する1件", () => {
    const json = { tasks: [{ taskId: "t1", title: "精算", due: "2026-11-12" }, { taskId: "t2", title: "精算", due: "2026-11-20" }] };
    assert.deepEqual(findCreatedTask(json, "精算", "2026-11-12"), { targetId: "t1" });
    assert.equal(findCreatedTask(json, "精算", null), null);
  });
});

describe("表示", () => {
  it("鍵とバッジ", () => {
    assert.equal(linkKey("event", "e1"), "event:e1");
    assert.equal(mailBadgeLabel(1), "✉");
    assert.equal(mailBadgeLabel(3), "✉ 3通");
  });
});
