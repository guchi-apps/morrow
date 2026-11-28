import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, describe, it } from "node:test";

import { createAideControl } from "../hermes-bridge/aide.ts";
import type { HermesLink } from "../hermes-bridge/hermes-link.ts";
import { createBridgeServer } from "../hermes-bridge/server.ts";
import { createHermesClient, HermesError } from "@/lib/hermes/client-core";

/**
 * AIDEの再接続・再ログイン（#1240）。Hermes本体のRPCの形は2026-11-28にsubpcで確認した:
 * - `mcp.servers.status` → `{servers: [{name, transport, tools, connected, disabled, status, source}], checked_at}`
 * - `mcp.servers.test {name}` → `{ok, tools: [...], prompts, resources, oauth_needed, oauth_tokens_present}`（失敗時は `error`）
 * - `reload.mcp {confirm: true}` → 全セッションのMCPを畳んで張り直す（`confirm` が無いと `confirm_required`）
 * - `mcp.servers.oauth.start {name, client_redirect_uri?}` → `{ok, session_id, auth_url, flow: "pkce"}`
 * - `mcp.servers.oauth.callback {name, session_id, code, state, error, iss}` → `{ok}`（stateはHermesが照合）
 * - `mcp.servers.oauth.poll {name, session_id}` → `{status: pending|approved|error}`
 * （Hermesの `tui_gateway/contracts/tools_mcp_plugins.py`・`methods_tools.py`・`mcp_oauth_sessions.py`）
 */

const FLOW_ID = "flow_abcdefghijklmnopqrstuv";
const AUTH_URL = "https://aide.gucchii.com/oauth/authorize?client_id=x&state=s1";
const CALLBACK = "http://127.0.0.1:52215/callback?code=c1&state=s1";

type Script = (method: string, params: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>;

function fakeConnect(script: Script) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  let closed = 0;
  const connect = async (): Promise<HermesLink> => ({
    async rpc(method, params) {
      calls.push({ method, params });
      return script(method, params);
    },
    reply() {},
    onEvent() {},
    onServerRequest() {},
    onClose() {},
    close() {
      closed++;
    },
  });
  return { connect, calls, closedCount: () => closed };
}

const okStatus = { servers: [{ name: "aide", status: "connected", connected: true, tools: 35 }] };

describe("createAideControl", () => {
  it("再接続は reload.mcp（confirm）の後に状態を読む", async () => {
    const hermes = fakeConnect((method) => (method === "mcp.servers.status" ? okStatus : { status: "reloaded" }));
    const control = createAideControl({ connect: hermes.connect });
    assert.equal(await control.reconnect(), "ok");
    assert.deepEqual(
      hermes.calls.map((c) => c.method),
      ["reload.mcp", "mcp.servers.status"],
    );
    assert.deepEqual(hermes.calls[0].params, { confirm: true });
    assert.equal(hermes.closedCount(), 1);
  });

  it("ログインは登録済みの戻り先で始め、貼り付けたURLのcode・stateを渡して保存を待つ", async () => {
    let polls = 0;
    const hermes = fakeConnect((method) => {
      if (method === "mcp.servers.oauth.start") return { ok: true, session_id: FLOW_ID, auth_url: AUTH_URL, flow: "pkce" };
      if (method === "mcp.servers.oauth.callback") return { ok: true };
      if (method === "mcp.servers.oauth.poll") return { status: ++polls < 2 ? "pending" : "approved" };
      if (method === "mcp.servers.status") return okStatus;
      return {};
    });
    const control = createAideControl({
      connect: hermes.connect,
      registeredRedirect: async () => "http://127.0.0.1:52215/callback",
      pollIntervalMs: 1,
    });
    assert.deepEqual(await control.startLogin(), { flowId: FLOW_ID, authUrl: AUTH_URL });
    assert.deepEqual(hermes.calls[0].params, { name: "aide", client_redirect_uri: "http://127.0.0.1:52215/callback" });

    assert.equal(await control.completeLogin(FLOW_ID, `  ${CALLBACK}  `), "ok");
    const callback = hermes.calls.find((c) => c.method === "mcp.servers.oauth.callback");
    assert.deepEqual(callback?.params, { name: "aide", session_id: FLOW_ID, code: "c1", state: "s1", error: null, iss: null });
    assert.ok(hermes.calls.some((c) => c.method === "reload.mcp"));
  });

  it("前のログインが残っていれば取り消してから始める", async () => {
    const hermes = fakeConnect((method) =>
      method === "mcp.servers.oauth.start" ? { ok: true, session_id: FLOW_ID, auth_url: AUTH_URL } : { ok: true },
    );
    const control = createAideControl({ connect: hermes.connect });
    await control.startLogin();
    await control.startLogin();
    const cancel = hermes.calls.find((c) => c.method === "mcp.servers.oauth.cancel");
    assert.deepEqual(cancel?.params, { name: "aide", session_id: FLOW_ID });
    // 登録済みの戻り先が無ければ client_redirect_uri を付けない（Hermesが登録し直す）
    assert.deepEqual(hermes.calls[0].params, { name: "aide" });
  });

  it("認可URLが https でない・idが読めない応答は通さない", async () => {
    for (const reply of [
      { ok: true, session_id: FLOW_ID, auth_url: "javascript:alert(1)" },
      { ok: true, session_id: FLOW_ID, auth_url: "http://aide.example/authorize" },
      { ok: true, session_id: "../x", auth_url: AUTH_URL },
    ]) {
      const control = createAideControl({ connect: fakeConnect(() => reply).connect });
      await assert.rejects(control.startLogin(), (error: unknown) => (error as { reason?: string }).reason === "login_failed");
    }
  });

  it("形の違う貼り付けはHermesへ渡さない", async () => {
    const hermes = fakeConnect(() => ({ ok: true }));
    const control = createAideControl({ connect: hermes.connect });
    for (const pasted of ["https://evil.example/callback?code=c&state=s", "http://127.0.0.1:1/other?code=c&state=s", "http://127.0.0.1:1/callback?code=c", "not a url"]) {
      await assert.rejects(control.completeLogin(FLOW_ID, pasted), (error: unknown) => (error as { reason?: string }).reason === "bad_request");
    }
    await assert.rejects(control.completeLogin("x", CALLBACK), (error: unknown) => (error as { reason?: string }).reason === "bad_request");
    assert.equal(hermes.calls.length, 0);
  });

  it("Hermesが受け付けない・保存されないときは失敗にし、流れを取り消して元のトークンへ戻させる", async () => {
    // Hermesの oauth.start は始めた時点で今のトークンを消す（2026-11-28に実測）。待つ流れを残さない
    const rejecting = fakeConnect(() => ({ ok: false, error_message: "state mismatch" }));
    const rejected = createAideControl({ connect: rejecting.connect });
    await assert.rejects(rejected.completeLogin(FLOW_ID, CALLBACK), (error: unknown) => (error as { reason?: string }).reason === "login_rejected");
    assert.deepEqual(rejecting.calls.at(-1), { method: "mcp.servers.oauth.cancel", params: { name: "aide", session_id: FLOW_ID } });

    const failed = createAideControl({
      connect: fakeConnect((method) => (method === "mcp.servers.oauth.poll" ? { status: "error" } : { ok: true })).connect,
    });
    await assert.rejects(failed.completeLogin(FLOW_ID, CALLBACK), (error: unknown) => (error as { reason?: string }).reason === "login_failed");

    const stuck = createAideControl({
      connect: fakeConnect((method) => (method === "mcp.servers.oauth.poll" ? { status: "pending" } : { ok: true })).connect,
      pollLimitMs: 5,
      pollIntervalMs: 1,
    });
    await assert.rejects(stuck.completeLogin(FLOW_ID, CALLBACK), (error: unknown) => (error as { reason?: string }).reason === "login_failed");
  });

  it("取り消しは oauth.cancel を呼ぶ（形の違うidは渡さない）", async () => {
    const hermes = fakeConnect(() => ({ ok: true, status: "error" }));
    const control = createAideControl({ connect: hermes.connect });
    await control.cancelLogin(FLOW_ID);
    assert.deepEqual(hermes.calls, [{ method: "mcp.servers.oauth.cancel", params: { name: "aide", session_id: FLOW_ID } }]);
    await assert.rejects(control.cancelLogin("../x"), (error: unknown) => (error as { reason?: string }).reason === "bad_request");
  });
});

describe("ブリッジの /aide/* とMorrowのクライアント", () => {
  const servers: Server[] = [];
  after(() => {
    for (const server of servers) {
      server.closeAllConnections();
      server.close();
    }
  });

  async function start(script: Script) {
    const hermes = fakeConnect(script);
    const server = createBridgeServer({
      token: "t",
      allowedIps: ["100.100.1.1"],
      connect: hermes.connect,
      aide: createAideControl({ connect: hermes.connect, pollIntervalMs: 1 }),
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const fetchImpl: typeof fetch = (input, init) =>
      fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), "x-forwarded-for": "100.100.1.1" } });
    return createHermesClient({ baseUrl, token: "t", fetchImpl });
  }

  it("再接続・ログインの開始と完了が通る", async () => {
    const client = await start((method) => {
      if (method === "mcp.servers.oauth.start") return { ok: true, session_id: FLOW_ID, auth_url: AUTH_URL };
      if (method === "mcp.servers.oauth.poll") return { status: "approved" };
      if (method === "mcp.servers.status") return okStatus;
      return { ok: true };
    });
    assert.equal(await client.reconnectAide(), "ok");
    assert.deepEqual(await client.startAideLogin(), { flowId: FLOW_ID, authUrl: AUTH_URL });
    assert.equal(await client.completeAideLogin(FLOW_ID, CALLBACK), "ok");
    await client.cancelAideLogin(FLOW_ID);
  });

  it("貼り付け違いは login_rejected、Hermesの失敗は hermes_down（文面は返さない）", async () => {
    const rejecting = await start(() => ({ ok: false }));
    await assert.rejects(rejecting.completeAideLogin(FLOW_ID, CALLBACK), (error: unknown) => error instanceof HermesError && error.kind === "login_rejected");
    await assert.rejects(
      rejecting.completeAideLogin(FLOW_ID, "http://127.0.0.1:1/callback"),
      (error: unknown) => error instanceof HermesError && error.kind === "bad_request",
    );

    const broken = await start(() => {
      throw new Error("secret detail");
    });
    await assert.rejects(broken.reconnectAide(), (error: unknown) => error instanceof HermesError && error.kind === "hermes_down");
  });
});
