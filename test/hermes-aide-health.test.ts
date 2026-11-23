import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { aideHealthFromStatus, isAideHealth } from "@/lib/hermes/aide-health";

/** HermesがAIDEの道具を読み込めているかの判定（#1158。実測: `aide: connected / tools 33`）。 */

const status = (entry: Record<string, unknown> | null) => ({
  servers: [
    ...(entry ? [{ name: "aide", transport: "http", disabled: false, ...entry }] : []),
    { name: "morrow_propose", status: "connected", connected: true, tools: 1 },
  ],
});

describe("aideHealthFromStatus", () => {
  it("接続済みで道具があれば ok（実測の形）", () => {
    assert.equal(aideHealthFromStatus(status({ status: "connected", connected: true, tools: 33 })), "ok");
    assert.equal(aideHealthFromStatus(status({ status: "lazy", connected: false, tools: 33 })), "ok");
  });

  it("OAuthが切れて道具が読み込まれていない回は unavailable", () => {
    assert.equal(aideHealthFromStatus(status({ status: "failed", connected: false, tools: 0, error: "no cached tokens" })), "unavailable");
    assert.equal(aideHealthFromStatus(status({ status: "configured", connected: false, tools: 0 })), "unavailable");
    assert.equal(aideHealthFromStatus(status({ status: "connected", connected: true, tools: 0 })), "unavailable");
    assert.equal(aideHealthFromStatus(status({ status: "disabled", connected: false, tools: 0, disabled: true })), "unavailable");
  });

  it("接続の途中は connecting（警告にしない）", () => {
    assert.equal(aideHealthFromStatus(status({ status: "connecting", connected: false, tools: 0 })), "connecting");
  });

  it("aideの行が無い・形が読めない回は null（切れていると断定しない）", () => {
    assert.equal(aideHealthFromStatus(status(null)), null);
    assert.equal(aideHealthFromStatus({}), null);
    assert.equal(aideHealthFromStatus(null), null);
    assert.equal(aideHealthFromStatus({ servers: "x" }), null);
  });

  it("isAideHealth は3状態だけ通す", () => {
    assert.ok(isAideHealth("ok") && isAideHealth("connecting") && isAideHealth("unavailable"));
    assert.ok(!isAideHealth("failed") && !isAideHealth(undefined));
  });
});
