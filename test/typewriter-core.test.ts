import assert from "node:assert/strict";
import test from "node:test";

import { elapsedLabel, splitVisible, TYPEWRITER_MAX_MS, visibleChars } from "../src/lib/mail/typewriter-core.ts";

test("visibleChars: 開始前は0、終わったら全部", () => {
  assert.equal(visibleChars(100, 0), 0);
  assert.equal(visibleChars(100, -5), 0);
  assert.equal(visibleChars(100, TYPEWRITER_MAX_MS), 100);
  assert.equal(visibleChars(100, 99999), 100);
});

test("visibleChars: 短い文は標準の間隔、長い文は上限の時間で終わる", () => {
  assert.equal(visibleChars(10, 28 * 5), 5);
  assert.equal(visibleChars(1000, TYPEWRITER_MAX_MS / 2), 500);
});

test("visibleChars: 空・不正な値は0", () => {
  assert.equal(visibleChars(0, 1000), 0);
  assert.equal(visibleChars(Number.NaN, 1000), 0);
  assert.equal(visibleChars(10, Number.NaN), 0);
});

test("splitVisible: 先頭の部分から順に埋める", () => {
  assert.deepEqual(splitVisible(["abcd", "ef", "gh"], 0), ["", "", ""]);
  assert.deepEqual(splitVisible(["abcd", "ef", "gh"], 5), ["abcd", "e", ""]);
  assert.deepEqual(splitVisible(["abcd", "ef", "gh"], 99), ["abcd", "ef", "gh"]);
});

test("elapsedLabel", () => {
  assert.equal(elapsedLabel(18.9), "18秒");
  assert.equal(elapsedLabel(-1), "0秒");
});
