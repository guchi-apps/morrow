import assert from "node:assert/strict";
import { test } from "node:test";
import { compareWithYesterday, describeDiff } from "../src/lib/dashboard/temperature-diff.ts";

const cell = (temperature: number | null, yesterday: number | null) => ({ temperature, yesterday });

test("昨日が無ければnull", () => {
  assert.equal(compareWithYesterday([cell(10, null)], 0), null);
});
test("いまの時間の差を出す", () => {
  assert.deepEqual(compareWithYesterday([cell(10, 10), cell(10, 14)], 1), { kind: "colder", degrees: 4 });
  assert.deepEqual(compareWithYesterday([cell(15, 10)], 0), { kind: "warmer", degrees: 5 });
});
test("1度以内は同じくらい", () => {
  assert.deepEqual(compareWithYesterday([cell(10, 11)], 0), { kind: "same", degrees: 0 });
});
test("nowIndexが範囲外なら平均", () => {
  assert.deepEqual(compareWithYesterday([cell(10, 14), cell(12, 16)], -1), { kind: "colder", degrees: 4 });
});
test("文言", () => {
  assert.equal(describeDiff({ kind: "colder", degrees: 3 }, true), "いま昨日より 3° 寒い");
  assert.equal(describeDiff({ kind: "same", degrees: 0 }, false), "1日の平均で昨日と同じくらい");
});
