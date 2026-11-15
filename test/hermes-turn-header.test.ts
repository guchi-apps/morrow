import assert from "node:assert/strict";
import { test } from "node:test";

import { readTurnIdHeader, TURN_ID_HEADER } from "@/lib/hermes/turn-header";

test("ターンIDのヘッダーを読む", () => {
  assert.equal(readTurnIdHeader(new Headers({ [TURN_ID_HEADER]: "turn_abc-1" })), "turn_abc-1");
});

test("無い・形の違う値はnull", () => {
  assert.equal(readTurnIdHeader(new Headers()), null);
  assert.equal(readTurnIdHeader(new Headers({ [TURN_ID_HEADER]: "../x" })), null);
  assert.equal(readTurnIdHeader(new Headers({ [TURN_ID_HEADER]: "" })), null);
});
