import assert from "node:assert/strict";
import test from "node:test";

import { groupPushesByDay } from "../src/lib/dashboard/push-history.ts";

const row = (id: string, iso: string) => ({ id, createdAt: new Date(iso) });

test("日本時間の日付で割り、日付は新しい順・同じ日の中は古い順に並べる", () => {
  const rows = [
    row("today-late", "2026-10-19T03:00:00Z"), // 10/19 12:00 JST
    row("today-early", "2026-10-18T22:00:00Z"), // 10/19 07:00 JST（UTCではきのう）
    row("yesterday", "2026-10-18T14:59:00Z"), // 10/18 23:59 JST
    row("old", "2026-09-01T00:00:00Z"),
  ];
  const days = groupPushesByDay(rows);
  assert.deepEqual(
    days.map((day) => [day.dayKey, day.pushes.map((push) => push.id)]),
    [
      ["2026-10-19", ["today-early", "today-late"]],
      ["2026-10-18", ["yesterday"]],
      ["2026-09-01", ["old"]],
    ],
  );
  assert.equal(days[0].label, "10月19日(月)");
});

test("行が無ければ空", () => {
  assert.deepEqual(groupPushesByDay([]), []);
});
