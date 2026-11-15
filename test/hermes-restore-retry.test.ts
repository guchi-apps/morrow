import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nextRestoreDelay, RESTORE_RETRY_DELAYS_MS, shouldRetryRestore } from "@/lib/hermes/restore-retry";

describe("前回の会話の取り直しの再試行（#976）", () => {
  it("通信失敗・一時的な失敗は再試行し、会話が無い・指定不正は再試行しない", () => {
    assert.equal(shouldRetryRestore(null), true);
    assert.equal(shouldRetryRestore("unreachable"), true);
    assert.equal(shouldRetryRestore("hermes_down"), true);
    assert.equal(shouldRetryRestore("no_session"), false);
    assert.equal(shouldRetryRestore("invalid"), false);
  });

  it("待ち時間は順に伸び、尽きたら null", () => {
    assert.deepEqual(RESTORE_RETRY_DELAYS_MS.map((_, i) => nextRestoreDelay(i)), [...RESTORE_RETRY_DELAYS_MS]);
    assert.equal(nextRestoreDelay(RESTORE_RETRY_DELAYS_MS.length), null);
  });
});
