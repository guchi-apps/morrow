import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, describe, it } from "node:test";

import { authorize, bearerMatches, forwardedClient, parseAllowedIps } from "../hermes-bridge/auth.ts";
import { HermesRpcError, type HermesEvent, type HermesLink, type HermesServerRequest } from "../hermes-bridge/hermes-link.ts";
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

async function startBridge(connect: () => Promise<HermesLink>, overrides: { token?: string | undefined; allowedIps?: string[]; turnTimeoutMs?: number } = {}) {
  const server = createBridgeServer({
    token: "token" in overrides ? overrides.token : TOKEN,
    allowedIps: overrides.allowedIps ?? [CLIENT_IP],
    connect,
    turnTimeoutMs: overrides.turnTimeoutMs,
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
