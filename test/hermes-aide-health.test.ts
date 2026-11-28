import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  aideHealthFrom,
  isAideHealth,
  isSafeAuthUrl,
  parseAideCallbackUrl,
  parseAideProbe,
  readAideStatus,
  registeredLoopbackRedirect,
} from "@/lib/hermes/aide-health";

/** HermesがAIDEの道具を読み込めているかの判定（#1158・#1240。実測: `aide: connected / tools 33`）。 */

const status = (entry: Record<string, unknown> | null) => ({
  servers: [
    ...(entry ? [{ name: "aide", transport: "http", disabled: false, ...entry }] : []),
    { name: "morrow_propose", status: "connected", connected: true, tools: 1 },
  ],
});

describe("readAideStatus", () => {
  it("接続済みで道具があれば ok（実測の形）", () => {
    assert.equal(readAideStatus(status({ status: "connected", connected: true, tools: 33 })), "ok");
    assert.equal(readAideStatus(status({ status: "lazy", connected: false, tools: 33 })), "ok");
  });

  it("未接続・失敗・道具0本は suspect（確かめないと分からない）", () => {
    assert.equal(readAideStatus(status({ status: "failed", connected: false, tools: 0, error: "no cached tokens" })), "suspect");
    // #1240: 待機で畳まれた直後はこの形。切れているとは限らない
    assert.equal(readAideStatus(status({ status: "configured", connected: false, tools: 0 })), "suspect");
    assert.equal(readAideStatus(status({ status: "connected", connected: true, tools: 0 })), "suspect");
  });

  it("接続の途中は connecting、無効は disabled", () => {
    assert.equal(readAideStatus(status({ status: "connecting", connected: false, tools: 0 })), "connecting");
    assert.equal(readAideStatus(status({ status: "disabled", connected: false, tools: 0, disabled: true })), "disabled");
  });

  it("aideの行が無い・形が読めない回は null（切れていると断定しない）", () => {
    assert.equal(readAideStatus(status(null)), null);
    assert.equal(readAideStatus({}), null);
    assert.equal(readAideStatus(null), null);
    assert.equal(readAideStatus({ servers: "x" }), null);
  });
});

describe("aideHealthFrom", () => {
  const probe = (r: Record<string, unknown>) => parseAideProbe(r);

  it("ok・connecting はそのまま、disabled は unavailable", () => {
    assert.equal(aideHealthFrom("ok", null), "ok");
    assert.equal(aideHealthFrom("connecting", null), "connecting");
    assert.equal(aideHealthFrom("disabled", null), "unavailable");
    assert.equal(aideHealthFrom(null, null), null);
  });

  it("suspect は確かめた結果で決める（実測の形: 2026-11-28）", () => {
    const connected = probe({ ok: true, tools: [{ name: "aide_ping" }], prompts: 0, resources: 0, oauth_needed: true, oauth_tokens_present: true });
    assert.equal(aideHealthFrom("suspect", connected), "ok");
    assert.equal(aideHealthFrom("suspect", probe({ ok: false, tools: [], error: "x", oauth_needed: true, oauth_tokens_present: false })), "login_required");
    assert.equal(aideHealthFrom("suspect", probe({ ok: false, tools: [], error: "HTTP 401 Unauthorized", oauth_needed: true, oauth_tokens_present: true })), "login_required");
    assert.equal(aideHealthFrom("suspect", probe({ ok: false, tools: [], error: "connection refused", oauth_needed: true, oauth_tokens_present: true })), "unavailable");
    assert.equal(aideHealthFrom("suspect", probe({ ok: true, tools: [], oauth_needed: false })), "unavailable");
  });

  it("確かめられなかった suspect は何も出さない", () => {
    assert.equal(aideHealthFrom("suspect", null), null);
    assert.equal(parseAideProbe({}), null);
    assert.equal(parseAideProbe("x"), null);
  });

  it("isAideHealth は4状態だけ通す", () => {
    assert.ok(isAideHealth("ok") && isAideHealth("connecting") && isAideHealth("unavailable") && isAideHealth("login_required"));
    assert.ok(!isAideHealth("failed") && !isAideHealth(undefined));
  });
});

describe("再ログインの貼り付け・戻り先", () => {
  it("ループバックの /callback で state と code（か error）があるものだけ読む", () => {
    assert.deepEqual(parseAideCallbackUrl(" http://127.0.0.1:52215/callback?code=c1&state=s1 "), { code: "c1", state: "s1", error: null, iss: null });
    assert.deepEqual(parseAideCallbackUrl("http://localhost:52215/callback/?error=access_denied&state=s1&iss=https%3A%2F%2Faide"), {
      code: null,
      state: "s1",
      error: "access_denied",
      iss: "https://aide",
    });
    for (const bad of [
      "",
      "https://127.0.0.1:52215/callback?code=c&state=s",
      "http://evil.example/callback?code=c&state=s",
      "http://127.0.0.1.evil.example/callback?code=c&state=s",
      "http://127.0.0.1:52215/other?code=c&state=s",
      "http://127.0.0.1:52215/callback?code=c",
      "http://127.0.0.1:52215/callback?state=s",
      "code=c&state=s",
    ]) {
      assert.equal(parseAideCallbackUrl(bad), null, bad);
    }
  });

  it("認可URLは https だけ", () => {
    assert.ok(isSafeAuthUrl("https://aide.gucchii.com/oauth/authorize?x=1"));
    assert.ok(!isSafeAuthUrl("http://aide.gucchii.com/"));
    assert.ok(!isSafeAuthUrl("javascript:alert(1)"));
    assert.ok(!isSafeAuthUrl(42));
  });

  it("登録済みの戻り先はループバックの /callback だけ拾う（aide.client.json の形）", () => {
    assert.equal(registeredLoopbackRedirect({ redirect_uris: ["http://127.0.0.1:52215/callback"], client_id: "x" }), "http://127.0.0.1:52215/callback");
    assert.equal(registeredLoopbackRedirect({ redirect_uris: ["https://proxy.example/callback", "http://127.0.0.1:1/callback"] }), "http://127.0.0.1:1/callback");
    assert.equal(registeredLoopbackRedirect({ redirect_uris: ["http://127.0.0.1/callback"] }), null);
    assert.equal(registeredLoopbackRedirect({}), null);
    assert.equal(registeredLoopbackRedirect(null), null);
  });
});
