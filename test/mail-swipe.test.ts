import assert from "node:assert/strict";
import { test } from "node:test";

import {
  archiveThreshold,
  followOffset,
  isArchiveRelease,
  lockDirection,
  startsAtScreenEdge,
} from "../src/components/mail/swipe-archive.ts";

test("向きは最初の動きの大きい方で決め、動きが小さい間は決めない", () => {
  assert.equal(lockDirection(5, 5), null);
  assert.equal(lockDirection(-20, 4), "h");
  assert.equal(lockDirection(3, 30), "v");
});

test("しきい値は行幅の35%、最低80px", () => {
  assert.equal(archiveThreshold(393), 393 * 0.35);
  assert.equal(archiveThreshold(100), 80);
});

test("左へ引いた分だけ追従し、右へは動かさない", () => {
  assert.equal(followOffset(-50), -50);
  assert.equal(followOffset(40), 0);
});

test("しきい値を超えて離したときだけアーカイブする", () => {
  assert.equal(isArchiveRelease(-100, 393), false);
  assert.equal(isArchiveRelease(-140, 393), true);
});

test("画面の左右24pxからの操作は無視する", () => {
  assert.equal(startsAtScreenEdge(10, 393), true);
  assert.equal(startsAtScreenEdge(385, 393), true);
  assert.equal(startsAtScreenEdge(200, 393), false);
});
