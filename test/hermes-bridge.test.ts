import assert from "node:assert/strict";
import { createServer as createHttpServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, describe, it } from "node:test";

import { authorize, bearerMatches, forwardedClient, parseAllowedIps } from "../hermes-bridge/auth.ts";
import { HermesRpcError, type HermesEvent, type HermesLink, type HermesServerRequest } from "../hermes-bridge/hermes-link.ts";
import { createHistoryReader, HistoryNotFoundError, projectHistory, type HistoryReader } from "../hermes-bridge/history.ts";
import { TurnLimiter } from "../hermes-bridge/limits.ts";
import { createBridgeServer } from "../hermes-bridge/server.ts";
import { allowedChoices } from "../hermes-bridge/turn.ts";
import { createHermesClient, HermesError } from "@/lib/hermes/client-core";
import type { BridgeEvent } from "@/lib/hermes/contract";

/** ブリッジ（#737）。Hermesの代わりに台本どおり動く偽の接続を差し込み、実際のHTTP/SSEで確かめる。 */

const TOKEN = "bridge-token-value";
const CLIENT_IP = "100.64.0.9";

describe("認証", () => {
  it("トークンが未設定なら何を送っても通らない", () => {
    assert.equal(bearerMatches("Bearer anything", undefined), false);
    assert.equal(bearerMatches("Bearer ", ""), false);
  });

  it("Bearerは一致したときだけ通る", () => {
    assert.equal(bearerMatches(`Bearer ${TOKEN}`, TOKEN), true);
    assert.equal(bearerMatches(`Bearer ${TOKEN}x`, TOKEN), false);
    assert.equal(bearerMatches(TOKEN, TOKEN), false);
    assert.equal(bearerMatches(undefined, TOKEN), false);
  });

  it("許可リストに無い・見出しが無い送信元は403、許可リストが空なら全部403", () => {
    const base = { authorization: `Bearer ${TOKEN}`, token: TOKEN };
    assert.equal(authorize({ ...base, forwardedFor: CLIENT_IP, allowedIps: [CLIENT_IP] }), "ok");
    assert.equal(authorize({ ...base, forwardedFor: "100.64.0.1", allowedIps: [CLIENT_IP] }), "forbidden");
    assert.equal(authorize({ ...base, forwardedFor: undefined, allowedIps: [CLIENT_IP] }), "forbidden");
    assert.equal(authorize({ ...base, forwardedFor: CLIENT_IP, allowedIps: [] }), "forbidden");
  });

  it("トークンが違えば、IPが許可リストにあっても401（IPの有無を漏らさない）", () => {
    assert.equal(
      authorize({ authorization: "Bearer wrong", token: TOKEN, forwardedFor: "1.2.3.4", allowedIps: [CLIENT_IP] }),
      "unauthorized",
    );
  });

  it("X-Forwarded-Forは先頭の1つを見る", () => {
    assert.equal(forwardedClient(`${CLIENT_IP}, 10.0.0.1`), CLIENT_IP);
    assert.deepEqual(parseAllowedIps(" a , b,,"), ["a", "b"]);
  });
});

describe("同時実行の制限", () => {
  it("1セッション1ターン、全体でmax本", () => {
    const limiter = new TurnLimiter(2);
    const a = limiter.acquireSlot();
    const b = limiter.acquireSlot();
    assert.equal(limiter.acquireSlot(), "bridge_busy");
    assert.equal(typeof a, "function");
    (a as () => void)();
    (a as () => void)(); // 二重に解放しても枠は1つ分しか空かない
    assert.equal(typeof limiter.acquireSlot(), "function");
    assert.equal(limiter.acquireSlot(), "bridge_busy");
    void b;

    const release = limiter.acquireSession("s1");
    assert.equal(limiter.acquireSession("s1"), "session_busy");
    (release as () => void)();
    assert.equal(typeof limiter.acquireSession("s1"), "function");
  });
});

describe("承認の選択肢の絞り込み", () => {
  it("always・sessionは落とし、denyは必ず残す", () => {
    assert.deepEqual(allowedChoices(["once", "session", "always", "deny"]), ["once", "deny"]);
    assert.deepEqual(allowedChoices(["always"]), ["deny"]);
    assert.deepEqual(allowedChoices(undefined), ["deny"]);
  });
});

/** 台本つきの偽のHermes接続。 */
class FakeLink implements HermesLink {
  calls: { method: string; params: Record<string, unknown> }[] = [];
  replies: { id: string; outcome: unknown }[] = [];
  closed = false;
  private eventHandler: (event: HermesEvent) => void = () => {};
  private requestHandler: (request: HermesServerRequest) => void = () => {};
  private closeHandler: () => void = () => {};

  private readonly script: (link: FakeLink, method: string, params: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>;

  constructor(script: (link: FakeLink, method: string, params: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>) {
    this.script = script;
  }

  async rpc(method: string, params: Record<string, unknown>) {
    this.calls.push({ method, params });
    return this.script(this, method, params);
  }
  reply(id: string, outcome: unknown) {
    this.replies.push({ id, outcome });
  }
  onEvent(handler: (event: HermesEvent) => void) {
    this.eventHandler = handler;
  }
  onServerRequest(handler: (request: HermesServerRequest) => void) {
    this.requestHandler = handler;
  }
  onClose(handler: () => void) {
    this.closeHandler = handler;
  }
  close() {
    this.closed = true;
  }
  emit(type: string, payload: Record<string, unknown> = {}, sessionId = "live-1") {
    this.eventHandler({ type, sessionId, payload });
  }
  request(id: string, method: string, params: Record<string, unknown>) {
    this.requestHandler({ id, method, sessionId: "live-1", params });
  }
  drop() {
    this.closeHandler();
  }
}

const servers: Server[] = [];
after(() => {
  for (const server of servers) {
    server.closeAllConnections();
    server.close();
  }
});

async function startBridge(connect: () => Promise<HermesLink>, overrides: { token?: string | undefined; allowedIps?: string[]; turnTimeoutMs?: number; history?: HistoryReader } = {}) {
  const server = createBridgeServer({
    token: "token" in overrides ? overrides.token : TOKEN,
    allowedIps: overrides.allowedIps ?? [CLIENT_IP],
    connect,
    turnTimeoutMs: overrides.turnTimeoutMs,
    history: overrides.history,
    heartbeatMs: 30,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  // tailscale serveの代わりに、送信元のIPを付ける
  const fetchImpl: typeof fetch = (input, init) =>
    fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), "x-forwarded-for": CLIENT_IP } });
  return { baseUrl, client: createHermesClient({ baseUrl, token: TOKEN, fetchImpl }) };
}

async function collect(events: AsyncGenerator<BridgeEvent>): Promise<BridgeEvent[]> {
  const out: BridgeEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

/** 台本: 作成 → prompt.submit で本文を流して完了する。 */
function simpleChat(): () => Promise<HermesLink> {
  return async () =>
    new FakeLink((link, method) => {
      if (method === "session.create") return { session_id: "live-1", stored_session_id: "stored-1" };
      if (method === "prompt.submit") {
        setTimeout(() => {
          link.emit("message.delta", { text: "こん" });
          link.emit("message.delta", { text: "にちは" });
          link.emit("skin.changed", {}); // 通さないイベント
          link.emit("message.complete", { text: "こんにちは", status: "complete", usage: { input: 10, output: 5 } });
        }, 5);
      }
      return {};
    });
}

describe("POST /turns（SSE）", () => {
  it("セッションを作り、イベントを種類別に流して、完了で閉じる", async () => {
    const links: FakeLink[] = [];
    const { client } = await startBridge(async () => {
      const link = (await simpleChat()()) as FakeLink;
      links.push(link);
      return link;
    });
    const events = await collect(await client.startTurn({ text: "やあ", title: "t" }));
    assert.deepEqual(
      events.map((event) => event.type),
      ["turn", "message.delta", "message.delta", "message.complete"],
    );
    const turn = events[0] as Extract<BridgeEvent, { type: "turn" }>;
    assert.equal(turn.data.sessionId, "stored-1");
    const complete = events[3] as Extract<BridgeEvent, { type: "message.complete" }>;
    assert.equal(complete.data.usage?.input, 10);

    const link = links[0];
    assert.deepEqual(
      link.calls.map((call) => call.method),
      ["client.capabilities", "session.create", "prompt.submit"],
    );
    assert.deepEqual(link.calls[0].params, { server_requests: true });
    assert.equal(link.calls[1].params.source, "morrow");
    assert.equal(link.calls[2].params.text, "やあ");
    assert.equal(link.closed, true);
  });

  it("続きのセッションは session.resume で再開する", async () => {
    const links: FakeLink[] = [];
    const { client } = await startBridge(async () => {
      const link = new FakeLink((self, method) => {
        if (method === "session.resume") return { session_id: "live-1" };
        if (method === "prompt.submit") setTimeout(() => self.emit("message.complete", { text: "ok" }), 5);
        return {};
      });
      links.push(link);
      return link;
    });
    const events = await collect(await client.startTurn({ text: "続き", sessionId: "stored-9" }));
    assert.equal((events[0] as Extract<BridgeEvent, { type: "turn" }>).data.sessionId, "stored-9");
    assert.equal(links[0].calls[1].method, "session.resume");
    assert.equal(links[0].calls[1].params.session_id, "stored-9");
  });

  it("続きのセッションが無ければ no_session", async () => {
    const { client } = await startBridge(async () =>
      new FakeLink((_link, method) => {
        if (method === "session.resume") throw new HermesRpcError(4001, "session not found");
        return {};
      }),
    );
    await assert.rejects(client.startTurn({ text: "x", sessionId: "gone" }), (error: unknown) => error instanceof HermesError && error.kind === "no_session");
  });

  it("Hermesへ繋がらなければ hermes_down（503）", async () => {
    const { client } = await startBridge(async () => {
      throw new Error("refused");
    });
    await assert.rejects(client.startTurn({ text: "x" }), (error: unknown) => error instanceof HermesError && error.kind === "hermes_down");
  });

  it("本文が空・長すぎる・sessionIdが不正なら400", async () => {
    const { baseUrl } = await startBridge(simpleChat());
    for (const body of [{ text: "" }, { text: 1 }, { text: "a", sessionId: "../x" }, { text: "a".repeat(20_001) }]) {
      const response = await fetch(`${baseUrl}/turns`, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "x-forwarded-for": CLIENT_IP, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 400, JSON.stringify(body));
    }
  });

  it("同じセッションの2本目は409", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { client } = await startBridge(async () =>
      new FakeLink((link, method) => {
        if (method === "session.resume") return { session_id: "live-1" };
        if (method === "prompt.submit") void gate.then(() => link.emit("message.complete", { text: "ok" }));
        return {};
      }),
    );
    const first = await client.startTurn({ text: "a", sessionId: "s1" });
    await assert.rejects(client.startTurn({ text: "b", sessionId: "s1" }), (error: unknown) => error instanceof HermesError && error.kind === "session_busy");
    release();
    await collect(first);
  });

  it("全体で2本を超えると429", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { client } = await startBridge(async () =>
      new FakeLink((link, method) => {
        if (method === "session.resume") return { session_id: "live-1" };
        if (method === "prompt.submit") void gate.then(() => link.emit("message.complete", { text: "ok" }));
        return {};
      }),
    );
    // 新規セッションは保存idが同じ（live-1）になり衝突するので、続きのセッションで枠を埋める
    const links = [await client.startTurn({ text: "a", sessionId: "s1" }), await client.startTurn({ text: "b", sessionId: "s2" })];
    await assert.rejects(client.startTurn({ text: "c", sessionId: "s3" }), (error: unknown) => error instanceof HermesError && error.kind === "bridge_busy");
    release();
    await Promise.all(links.map(collect));
  });
});

describe("承認・中断", () => {
  function approvalChat(links: FakeLink[]): () => Promise<HermesLink> {
    return async () => {
      const link = new FakeLink((self, method, params) => {
        if (method === "session.create") return { session_id: "live-1", stored_session_id: "stored-1" };
        if (method === "prompt.submit") {
          setTimeout(() => self.request("srq-1", "approval", { request_id: "req-1", command: "rm x", choices: ["once", "session", "always", "deny"] }), 5);
        }
        if (method === "approval.respond") setTimeout(() => self.emit("message.complete", { text: String(params.choice) }), 5);
        return {};
      });
      links.push(link);
      return link;
    };
  }

  it("approvalはonce・denyだけの選択肢で流れ、回答はHermesへ渡る", async () => {
    const links: FakeLink[] = [];
    const { client } = await startBridge(approvalChat(links));
    const stream = await client.startTurn({ text: "消して" });
    const seen: BridgeEvent[] = [];
    let turnId = "";
    for await (const event of stream) {
      seen.push(event);
      if (event.type === "turn") turnId = event.data.turnId;
      if (event.type === "approval") {
        assert.deepEqual(event.data.choices, ["once", "deny"]);
        await client.answerApproval(turnId, event.data.requestId, "once");
      }
    }
    assert.deepEqual(
      seen.map((event) => event.type),
      ["turn", "approval", "message.complete"],
    );
    const respond = links[0].calls.find((call) => call.method === "approval.respond");
    assert.deepEqual(respond?.params, { session_id: "live-1", request_id: "req-1", choice: "once", all: false });
  });

  it("always・sessionの回答は400で、Hermesへ届かない", async () => {
    const links: FakeLink[] = [];
    const { baseUrl, client } = await startBridge(approvalChat(links));
    const stream = await client.startTurn({ text: "消して" });
    let turnId = "";
    for await (const event of stream) {
      if (event.type === "turn") turnId = event.data.turnId;
      if (event.type === "approval") {
        for (const choice of ["always", "session", "yes"]) {
          const response: Response = await fetch(`${baseUrl}/turns/${turnId}/approval`, {
            method: "POST",
            headers: { authorization: `Bearer ${TOKEN}`, "x-forwarded-for": CLIENT_IP, "content-type": "application/json" },
            body: JSON.stringify({ requestId: event.data.requestId, choice }),
          });
          assert.equal(response.status, 400, choice);
        }
        assert.equal(links[0].calls.some((call) => call.method === "approval.respond"), false);
        await client.answerApproval(turnId, event.data.requestId, "deny");
      }
    }
  });

  it("待っていないrequestIdへの回答・終わったターンの宛先は404", async () => {
    const { baseUrl, client } = await startBridge(simpleChat());
    const stream = await client.startTurn({ text: "x" });
    let turnId = "";
    for await (const event of stream) if (event.type === "turn") turnId = event.data.turnId;
    await assert.rejects(client.answerApproval(turnId, "req-1", "once"), (error: unknown) => error instanceof HermesError && error.kind === "turn_not_found");
    const response = await fetch(`${baseUrl}/turns/${turnId}/interrupt`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "x-forwarded-for": CLIENT_IP, "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(response.status, 404);
  });

  it("interruptは session.interrupt をHermesへ送る", async () => {
    const links: FakeLink[] = [];
    const { client } = await startBridge(async () => {
      const link = new FakeLink((self, method) => {
        if (method === "session.create") return { session_id: "live-1" };
        if (method === "session.interrupt") setTimeout(() => self.emit("message.complete", { text: null, status: "interrupted" }), 5);
        return {};
      });
      links.push(link);
      return link;
    });
    const stream = await client.startTurn({ text: "長い仕事" });
    const seen: string[] = [];
    for await (const event of stream) {
      seen.push(event.type);
      if (event.type === "turn") await client.interrupt(event.data.turnId);
    }
    assert.deepEqual(seen, ["turn", "message.complete"]);
    assert.ok(links[0].calls.some((call) => call.method === "session.interrupt"));
  });

  it("clarifyは質問として流し、Hermesへは辞退で返す", async () => {
    const links: FakeLink[] = [];
    const { client } = await startBridge(async () => {
      const link = new FakeLink((self, method) => {
        if (method === "session.create") return { session_id: "live-1" };
        if (method === "prompt.submit") {
          setTimeout(() => {
            self.request("srq-2", "clarify", { questions: [{ q: "どちら？" }] });
            self.emit("message.complete", { text: "どちらですか" });
          }, 5);
        }
        return {};
      });
      links.push(link);
      return link;
    });
    const events = await collect(await client.startTurn({ text: "x" }));
    assert.ok(events.some((event) => event.type === "clarify"));
    assert.equal(links[0].replies.length, 1);
    assert.equal(links[0].replies[0].id, "srq-2");
  });
});

describe("上限・切断・ハートビート", () => {
  it("1ターンの上限を超えたら中断してtimeoutで終わる", async () => {
    const links: FakeLink[] = [];
    const { client } = await startBridge(
      async () => {
        const link = new FakeLink((_self, method) => (method === "session.create" ? { session_id: "live-1" } : {}));
        links.push(link);
        return link;
      },
      { turnTimeoutMs: 60 },
    );
    const events = await collect(await client.startTurn({ text: "x" }));
    const last = events.at(-1) as Extract<BridgeEvent, { type: "error" }>;
    assert.equal(last.type, "error");
    assert.equal(last.data.reason, "timeout");
    assert.ok(links[0].calls.some((call) => call.method === "session.interrupt"));
  });

  it("Morrowが切断したら session.interrupt を送る", async () => {
    const links: FakeLink[] = [];
    const { client } = await startBridge(async () => {
      const link = new FakeLink((self, method) => {
        if (method === "session.create") return { session_id: "live-1" };
        if (method === "session.interrupt") setTimeout(() => self.emit("message.complete", { text: null }), 5);
        return {};
      });
      links.push(link);
      return link;
    });
    const controller = new AbortController();
    const stream = await client.startTurn({ text: "x" }, controller.signal);
    await stream.next(); // turn
    controller.abort();
    await assert.rejects(stream.next());
    const deadline = Date.now() + 1000;
    while (!links[0].calls.some((call) => call.method === "session.interrupt") && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(links[0].calls.some((call) => call.method === "session.interrupt"));
  });

  it("Hermesとの接続が途中で切れたら hermes_down のエラーで終わる", async () => {
    const { client } = await startBridge(async () => {
      const link = new FakeLink((self, method) => {
        if (method === "session.create") return { session_id: "live-1" };
        if (method === "prompt.submit") setTimeout(() => self.drop(), 5);
        return {};
      });
      return link;
    });
    const events = await collect(await client.startTurn({ text: "x" }));
    assert.equal((events.at(-1) as Extract<BridgeEvent, { type: "error" }>).data.reason, "hermes_down");
  });

  it("待ち時間のあいだ、コメント行のハートビートが流れる", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { baseUrl } = await startBridge(async () =>
      new FakeLink((link, method) => {
        if (method === "session.create") return { session_id: "live-1" };
        if (method === "prompt.submit") void gate.then(() => link.emit("message.complete", { text: "ok" }));
        return {};
      }),
    );
    const response = await fetch(`${baseUrl}/turns`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "x-forwarded-for": CLIENT_IP, "content-type": "application/json" },
      body: JSON.stringify({ text: "x" }),
    });
    setTimeout(release, 150);
    const text = await response.text();
    assert.match(text, /: ping/);
    assert.match(text, /event: message\.complete/);
  });
});

describe("認証とルーティング", () => {
  it("トークン未設定なら全部401、許可リスト外は403", async () => {
    const unset = await startBridge(simpleChat(), { token: undefined });
    const response = await fetch(`${unset.baseUrl}/health`, { headers: { authorization: "Bearer x", "x-forwarded-for": CLIENT_IP } });
    assert.equal(response.status, 401);

    const closed = await startBridge(simpleChat(), { allowedIps: [] });
    const denied = await fetch(`${closed.baseUrl}/health`, { headers: { authorization: `Bearer ${TOKEN}`, "x-forwarded-for": CLIENT_IP } });
    assert.equal(denied.status, 403);
    await assert.rejects(closed.client.health(), (error: unknown) => error instanceof HermesError && error.kind === "rejected");
  });

  it("/health はHermesの状態を返し、知らないパスは404（設定・削除などは通さない）", async () => {
    const ok = await startBridge(simpleChat());
    assert.deepEqual(await ok.client.health(), { bridge: "ok", hermes: "ok" });

    const down = await startBridge(async () => {
      throw new Error("refused");
    });
    assert.deepEqual(await down.client.health(), { bridge: "ok", hermes: "down" });

    for (const path of ["/tools.configure", "/api/sessions", "/sessions/x"]) {
      const response = await fetch(`${ok.baseUrl}${path}`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "x-forwarded-for": CLIENT_IP } });
      assert.equal(response.status, 404, path);
    }
  });
});

interface McpReply {
  result: { protocolVersion: string; tools: { name: string }[]; content: { text: string }[] };
  error: { code: number };
}

describe("提案用のMCP（morrow_propose_action）", () => {
  it("initialize・tools/list・tools/call に答え、何も実行しない固定の文を返す", async () => {
    const { createProposeMcpServer, PROPOSE_RESULT_TEXT, PROPOSE_TOOL_NAME } = await import("../hermes-bridge/propose-mcp.ts");
    const server = createProposeMcpServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    const { port } = server.address() as AddressInfo;
    const post = async (body: unknown) => {
      const response = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return { status: response.status, json: response.status === 200 ? ((await response.json()) as McpReply) : null };
    };

    const init = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    assert.equal(init.json?.result.protocolVersion, "2025-06-18");
    assert.equal((await post({ jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);

    const list = await post({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    assert.deepEqual(list.json?.result.tools.map((tool) => tool.name), [PROPOSE_TOOL_NAME]);

    const call = await post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: PROPOSE_TOOL_NAME, arguments: { tool: "aide_delete_event", args: {}, summary: "x" } } });
    assert.equal(call.json?.result.content[0].text, PROPOSE_RESULT_TEXT);
    assert.match(PROPOSE_RESULT_TEXT, /実行済みとは言わない/);

    const unknown = await post({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "other" } });
    assert.equal(unknown.json?.error.code, -32602);
  });
});

describe("履歴の絞り込み（#752）", () => {
  it("利用者とHermesの発言だけを残し、道具は名前だけ・システム注記や推論は返さない", () => {
    const rows = [
      {
        id: 1,
        role: "user",
        content: "明日の予定は？",
        api_content: "明日の予定は？\n\n[System note: ...]",
        timestamp: 1794145887.768,
        message_uid: "u1",
      },
      {
        id: 2,
        role: "assistant",
        content: "",
        tool_calls: JSON.stringify([{ id: "c1", type: "function", function: { name: "aide_schedule", arguments: '{"days":1}' } }]),
        codex_reasoning_items: '[{"encrypted_content":"secret"}]',
        reasoning: "考えた中身",
        timestamp: 1794145888,
      },
      { id: 3, role: "tool", tool_name: "aide_schedule", content: '{"events":[{"title":"歯医者"}]}', timestamp: 1794145889 },
      { id: 4, role: "assistant", content: "10時に歯医者です。", timestamp: 1794145890 },
      { id: 5, role: "assistant", content: "要約", display_kind: "compaction_summary" },
      { id: 6, role: "system", content: "システム" },
      { id: 7, role: "user", content: [{ type: "text", text: "ありがとう" }, { type: "image_url", image_url: "data:..." }] },
      { id: 8, role: "assistant", content: "   " },
    ];
    const { messages, truncated } = projectHistory(rows, 50);
    assert.equal(truncated, false);
    assert.deepEqual(messages, [
      { role: "user", text: "明日の予定は？", at: 1794145887768 },
      { role: "assistant", text: "", at: 1794145888000, tools: ["aide_schedule"] },
      { role: "assistant", text: "10時に歯医者です。", at: 1794145890000 },
      { role: "user", text: "ありがとう", at: null },
    ]);
    const serialized = JSON.stringify(messages);
    for (const leaked of ["System note", "secret", "考えた中身", "days", "歯医者\"}"]) assert.equal(serialized.includes(leaked), false, leaked);
  });

  it("直近limit件だけを返し、落とした分があれば truncated", () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` }));
    const { messages, truncated } = projectHistory(rows, 2);
    assert.deepEqual(messages.map((m) => m.text), ["m3", "m4"]);
    assert.equal(truncated, true);
    assert.deepEqual(projectHistory("not-an-array", 5), { messages: [], truncated: false });
  });
});

/** HermesのRESTの代わり。受けたリクエストを記録し、決めた応答を返す。 */
async function startFakeHermesRest(handler: (path: string) => { status: number; body: unknown }) {
  const seen: { path: string; token: string | undefined }[] = [];
  const server = createHttpServer((req, res) => {
    const token = req.headers["x-hermes-session-token"];
    seen.push({ path: req.url ?? "", token: typeof token === "string" ? token : undefined });
    const { status, body } = handler(req.url ?? "");
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

describe("HermesのRESTから履歴を読む（#752）", () => {
  it("sourceがmorrowのセッションだけ読み、トークンを付け、多めに・新しい側から読む", async () => {
    const hermes = await startFakeHermesRest((path) => {
      if (path === "/api/sessions/s-morrow") return { status: 200, body: { id: "s-morrow", source: "morrow", title: "疎通確認" } };
      if (path.startsWith("/api/sessions/s-morrow/messages")) {
        return { status: 200, body: { messages: [{ role: "user", content: "やあ" }, { role: "assistant", content: "ことり" }] } };
      }
      return { status: 404, body: { detail: "not found" } };
    });
    const read = createHistoryReader({ url: hermes.url, token: "hermes-token", timeoutMs: 2_000 });
    const body = await read("s-morrow", 10);
    assert.deepEqual(body, {
      sessionId: "s-morrow",
      title: "疎通確認",
      hasMore: false,
      messages: [
        { role: "user", text: "やあ", at: null },
        { role: "assistant", text: "ことり", at: null },
      ],
    });
    assert.deepEqual(hermes.seen.map((r) => r.token), ["hermes-token", "hermes-token"]);
    assert.equal(hermes.seen[1].path, "/api/sessions/s-morrow/messages?limit=41&order=latest&inline_images=false");
  });

  it("Morrow以外のセッション（Discordなど）は中身を読まずに「無い」と同じ扱い", async () => {
    const hermes = await startFakeHermesRest((path) =>
      path === "/api/sessions/s-discord" ? { status: 200, body: { id: "s-discord", source: "discord" } } : { status: 404, body: {} },
    );
    const read = createHistoryReader({ url: hermes.url, token: "t", timeoutMs: 2_000 });
    await assert.rejects(read("s-discord", 10), HistoryNotFoundError);
    await assert.rejects(read("missing", 10), HistoryNotFoundError);
    // `..` はURLで畳まれて別のRESTを指すので、Hermesへ送らずに断る
    await assert.rejects(read("..", 10), HistoryNotFoundError);
    assert.equal(hermes.seen.some((r) => !r.path.startsWith("/api/sessions/")), false);
    assert.equal(hermes.seen.some((r) => r.path.includes("/messages")), false);
  });

  it("読んだページが一杯なら hasMore", async () => {
    const rows = Array.from({ length: 9 }, () => ({ role: "tool", content: "x" }));
    const hermes = await startFakeHermesRest((path) =>
      path.includes("/messages") ? { status: 200, body: { messages: rows } } : { status: 200, body: { source: "morrow" } },
    );
    const body = await createHistoryReader({ url: hermes.url, token: "t", timeoutMs: 2_000 })("s1", 2);
    assert.equal(body.hasMore, true);
    assert.deepEqual(body.messages, []);
    assert.equal(body.title, null);
  });
});

describe("GET /sessions/<id>/messages（#752）", () => {
  const sample: HistoryReader = async (sessionId, limit) => {
    if (sessionId === "missing") throw new HistoryNotFoundError("無い");
    if (sessionId === "broken") throw new Error("Hermesが500");
    return { sessionId, title: null, hasMore: false, messages: [{ role: "user", text: `limit=${limit}`, at: 1 }] };
  };

  it("履歴を返し、既定は50件", async () => {
    const { client } = await startBridge(simpleChat(), { history: sample });
    const body = await client.history("stored-1");
    assert.deepEqual(body.messages, [{ role: "user", text: "limit=50", at: 1 }]);
    assert.equal((await client.history("stored-1", { limit: 500 })).messages[0].text, "limit=100");
  });

  it("無い・Morrow以外は no_session、Hermesの失敗は hermes_down", async () => {
    const { client } = await startBridge(simpleChat(), { history: sample });
    await assert.rejects(client.history("missing"), (error: unknown) => error instanceof HermesError && error.kind === "no_session");
    await assert.rejects(client.history("broken"), (error: unknown) => error instanceof HermesError && error.kind === "hermes_down");
  });

  it("`..` などパスを畳む値は、履歴の読み取りまで届かない", async () => {
    const asked: string[] = [];
    const spy: HistoryReader = async (sessionId, limit) => {
      asked.push(sessionId);
      return sample(sessionId, limit);
    };
    const { baseUrl } = await startBridge(simpleChat(), { history: spy });
    const { port } = new URL(baseUrl);
    // fetchはURLを畳んでしまうので、生のパスのまま送る
    const rawStatus = (path: string) =>
      new Promise<number>((resolve, reject) => {
        const req = httpRequest(
          { host: "127.0.0.1", port, path, headers: { authorization: `Bearer ${TOKEN}`, "x-forwarded-for": CLIENT_IP } },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on("error", reject);
        req.end();
      });
    for (const path of ["/sessions/../messages", "/sessions/%2E%2E/messages", "/sessions/.%2e/messages", "/sessions/./messages"]) {
      assert.notEqual(await rawStatus(path), 200, path);
    }
    assert.deepEqual(asked, []);
  });

  it("limit・sessionIdが不正なら400、認証が無ければ401", async () => {
    const { baseUrl } = await startBridge(simpleChat(), { history: sample });
    const headers = { authorization: `Bearer ${TOKEN}`, "x-forwarded-for": CLIENT_IP };
    for (const path of ["/sessions/s1/messages?limit=0", "/sessions/s1/messages?limit=101", "/sessions/s1/messages?limit=abc", "/sessions/a%2Fb/messages"]) {
      assert.equal((await fetch(baseUrl + path, { headers })).status, 400, path);
    }
    assert.equal((await fetch(`${baseUrl}/sessions/s1/messages`, { headers: { "x-forwarded-for": CLIENT_IP } })).status, 401);
    assert.equal((await fetch(`${baseUrl}/sessions/s1/messages`, { method: "POST", headers })).status, 404);
  });
});
