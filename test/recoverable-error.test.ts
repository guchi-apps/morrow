import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AUTO_RELOAD_INTERVAL_MS, canAutoReload, isRecoverableError, parseReloadMark } from "../src/lib/recoverable-error.ts";

describe("isRecoverableError", () => {
  it("通信の途切れ・チャンクの取得失敗は読み込み直す", () => {
    for (const message of [
      "Connection closed.",
      "Load failed",
      "Failed to fetch",
      "NetworkError when attempting to fetch resource.",
      "The network connection was lost.",
      "Loading chunk 123 failed.",
      "Failed to load chunk /_next/static/chunks/abc.js",
      "Importing a module script failed.",
    ]) {
      assert.equal(isRecoverableError(new Error(message)), true, message);
    }
    const chunk = new Error("x");
    chunk.name = "ChunkLoadError";
    assert.equal(isRecoverableError(chunk), true);
  });

  it("それ以外の例外・サーバーの例外は読み込み直さない", () => {
    assert.equal(isRecoverableError(new TypeError("Cannot read properties of undefined (reading 'x')")), false);
    assert.equal(isRecoverableError(Object.assign(new Error("Connection closed."), { digest: "123" })), false);
    assert.equal(isRecoverableError(null), false);
    assert.equal(isRecoverableError("Load failed"), false);
  });
});

describe("canAutoReload", () => {
  it("印が無い・別のURLなら読み込み直す", () => {
    assert.equal(canAutoReload(null, "/mail/a", 1000), true);
    assert.equal(canAutoReload({ url: "/mail/b", at: 1000 }, "/mail/a", 1000), true);
  });
  it("同じURLで間隔内なら止める（ループさせない）", () => {
    assert.equal(canAutoReload({ url: "/mail/a", at: 1000 }, "/mail/a", 1000 + AUTO_RELOAD_INTERVAL_MS - 1), false);
    assert.equal(canAutoReload({ url: "/mail/a", at: 1000 }, "/mail/a", 1000 + AUTO_RELOAD_INTERVAL_MS), true);
  });
  it("時計が戻った印は古いものとして扱う", () => {
    assert.equal(canAutoReload({ url: "/mail/a", at: 5000 }, "/mail/a", 1000), true);
  });
});

describe("parseReloadMark", () => {
  it("形の合う値だけを読む", () => {
    assert.deepEqual(parseReloadMark(JSON.stringify({ url: "/x", at: 1 })), { url: "/x", at: 1 });
    assert.equal(parseReloadMark(null), null);
    assert.equal(parseReloadMark("{"), null);
    assert.equal(parseReloadMark(JSON.stringify({ url: 1, at: 1 })), null);
  });
});
