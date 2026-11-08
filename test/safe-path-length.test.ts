import test from "node:test";
import assert from "node:assert/strict";
import { NATIVE_NEXT_MAX_LENGTH, safeInternalPath } from "../src/lib/safe-path.ts";

test("上限ちょうどは通し、超えたら既定へ落とす", () => {
  const ok = "/" + "a".repeat(NATIVE_NEXT_MAX_LENGTH - 1);
  assert.equal(safeInternalPath(ok, "/", NATIVE_NEXT_MAX_LENGTH), ok);
  assert.equal(safeInternalPath(ok + "a", "/", NATIVE_NEXT_MAX_LENGTH), "/");
  assert.equal(safeInternalPath(ok + "a", "/"), ok + "a");
});
