import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, describe, it } from "node:test";

import { classifyFailure, createHermesClient, HermesError, parseHistoryBody } from "@/lib/hermes/client-core";
import { parseSseBlock, readBridgeEvents } from "@/lib/hermes/sse";
import { hermesUsageToApiUsage } from "@/lib/hermes/usage";
import { USAGE_FEATURE_LABELS } from "@/lib/usage-feature";

/** Morrow側のHermesクライアント（#737）。失敗の区別・SSEの読み取り・使用量の写し。 */

describe("失敗の区別（#214）", () => {
  it("HTTPの状態とブリッジの理由から、画面に出す種類を決める", () => {
    const kind = (status: number, reason?: string) => classifyFailure(status, reason).kind;
    assert.equal(kind(401, "unauthorized"), "rejected");
    assert.equal(kind(403, "forbidden"), "rejected");
    assert.equal(kind(502), "unreachable");
    assert.equal(kind(504), "unreachable");
    assert.equal(kind(503, "hermes_down"), "hermes_down");
    assert.equal(kind(503), "unreachable");
    assert.equal(kind(503, "feature_disabled"), "feature_disabled");
    assert.equal(kind(404, "no_session"), "no_session");
    assert.equal(kind(409, "session_busy"), "session_busy");
    assert.equal(kind(429, "bridge_busy"), "bridge_busy");
    assert.equal(kind(500), "bad_response");
    assert.equal(kind(404, "not_found"), "bridge_outdated");
    assert.equal(kind(404), "bad_response");
  });

  it("宛先やトークンが未設定なら、通信せずに not_configured", async () => {
    let called = false;
    const fetchImpl: typeof fetch = async () => {
      called = true;
      return new Response("{}");
    };
    for (const config of [
      { baseUrl: null, token: "t" },
      { baseUrl: "http://x", token: null },
    ]) {
      const client = createHermesClient({ ...config, fetchImpl });
      await assert.rejects(client.health(), (error: unknown) => error instanceof HermesError && error.kind === "not_configured");
    }
    assert.equal(called, false);
  });

  it("接続できない・応答が来ない（5秒の上限）は unreachable", async () => {
    const refused = createHermesClient({
      baseUrl: "http://127.0.0.1:9",
      token: "t",
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
    });
    await assert.rejects(refused.health(), (error: unknown) => error instanceof HermesError && error.kind === "unreachable");

    const hanging = createHermesClient({
      baseUrl: "http://127.0.0.1:9",
      token: "t",
      connectTimeoutMs: 30,
      fetchImpl: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        }),
    });
    await assert.rejects(hanging.health(), (error: unknown) => error instanceof HermesError && error.kind === "unreachable");
  });

  it("200で空の応答（会話が無い）は失敗にしない", async () => {
    const client = createHermesClient({
      baseUrl: "http://x",
      token: "t",
      fetchImpl: async () => new Response("", { status: 200, headers: { "content-type": "text/event-stream" } }),
    });
    const events = [];
    for await (const event of await client.startTurn({ text: "x" })) events.push(event);
    assert.deepEqual(events, []);
  });

  // 実際のHTTPサーバーへ繋ぐ試験は、接続の上限を既定（5秒）のままにする。
  // 以前は「本文には上限が掛からない」も同じ試験で40msの上限を付けて確かめていたが、
  // 負荷の高いCIランナーでは最初の接続（fetchの初期化を含む）が40msに間に合わず
  // unreachable で落ちていた（#1180。手元で16並列にすると16回中13回落ちた）。
  it("Bearerを付けてブリッジを呼び、SSEを読み切る", async () => {
    const seen: { auth: string | undefined }[] = [];
    const server = createServer((req, res) => {
      seen.push({ auth: req.headers.authorization });
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('event: turn\ndata: {"turnId":"t","sessionId":"s"}\n\n');
      setTimeout(() => {
        res.write('event: message.complete\ndata: {"text":"ok"}\n\n');
        res.end();
      }, 20);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    after(() => server.close());
    const { port } = server.address() as AddressInfo;
    const client = createHermesClient({ baseUrl: `http://127.0.0.1:${port}`, token: "secret-t" });
    const types: string[] = [];
    for await (const event of await client.startTurn({ text: "x" })) types.push(event.type);
    assert.deepEqual(types, ["turn", "message.complete"]);
    assert.equal(seen[0].auth, "Bearer secret-t");
  });

  // ヘッダーが届いた時点で上限のタイマーは外れる。fetchを差し替えて応答を即座に返し、
  // 本文の続きは上限を十分に超えてから流すので、実際の接続の速さに左右されない。
  it("接続のタイムアウトはストリーム本文には掛からない", async () => {
    const connectTimeoutMs = 20;
    let signal: AbortSignal | undefined;
    const encoder = new TextEncoder();
    const client = createHermesClient({
      baseUrl: "http://x",
      token: "t",
      connectTimeoutMs,
      fetchImpl: async (_input, init) => {
        signal = init?.signal ?? undefined;
        const body = new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(encoder.encode('event: turn\ndata: {"turnId":"t","sessionId":"s"}\n\n'));
            await new Promise((resolve) => setTimeout(resolve, connectTimeoutMs * 5));
            controller.enqueue(encoder.encode('event: message.complete\ndata: {"text":"ok"}\n\n'));
            controller.close();
          },
        });
        return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
      },
    });
    const types: string[] = [];
    for await (const event of await client.startTurn({ text: "x" })) types.push(event.type);
    assert.deepEqual(types, ["turn", "message.complete"]);
    assert.equal(signal?.aborted, false);
  });
});

describe("SSEの読み取り", () => {
  it("コメント行・知らない種類・壊れたJSONは捨てる", () => {
    assert.equal(parseSseBlock(": ping"), null);
    assert.equal(parseSseBlock('event: future.event\ndata: {"a":1}'), null);
    assert.equal(parseSseBlock("event: message.delta\ndata: {broken"), null);
    assert.deepEqual(parseSseBlock('event: message.delta\ndata: {"text":"あ"}'), { type: "message.delta", data: { text: "あ" } });
  });

  it("チャンクの境目がイベントの途中でも読める", async () => {
    const encoder = new TextEncoder();
    const text = 'event: message.delta\ndata: {"text":"こ"}\n\n: ping\n\nevent: message.delta\ndata: {"text":"ん"}\n\n';
    const bytes = encoder.encode(text);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // 日本語の途中で割る
        for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
        controller.close();
      },
    });
    const out: string[] = [];
    for await (const event of readBridgeEvents(stream)) out.push((event.data as { text: string }).text);
    assert.deepEqual(out, ["こ", "ん"]);
  });
});

describe("使用量の写し（#725の対応表）", () => {
  it("serveのinputはキャッシュ除外なので引き算しない", () => {
    const mapped = hermesUsageToApiUsage({ input: 12819, prompt: 37523, output: 233, cache_read: 24471, model: "gpt-6-sol" });
    assert.deepEqual(mapped, {
      model: "gpt-6-sol",
      usage: { inputTokens: 12819, outputTokens: 233, cacheWriteTokens: 0, cacheReadTokens: 24471 },
    });
  });

  it("キャッシュの項目が無ければ prompt − input を読み込みぶんとみなす", () => {
    const mapped = hermesUsageToApiUsage({ input: 100, prompt: 400, output: 10 });
    assert.equal(mapped?.usage.cacheReadTokens, 300);
    assert.equal(mapped?.model, "hermes");
  });

  it("取れない・全部0の回は行を作らない", () => {
    assert.equal(hermesUsageToApiUsage(undefined), null);
    assert.equal(hermesUsageToApiUsage({}), null);
    assert.equal(hermesUsageToApiUsage({ input: 0, output: 0 }), null);
  });

  it("機能名 hermes_chat が使用量APIの表に載る", () => {
    assert.ok(Object.hasOwn(USAGE_FEATURE_LABELS, "hermes_chat"));
  });
});

describe("履歴の応答の検証（#752）", () => {
  const ok = {
    sessionId: "s1",
    title: null,
    hasMore: true,
    messages: [
      { role: "user", text: "やあ", at: 1 },
      { role: "assistant", text: "", at: null, tools: ["aide_schedule"], extra: "捨てる" },
    ],
  };

  it("知っている項目だけで組み直す", () => {
    assert.deepEqual(parseHistoryBody(ok, "s1"), {
      sessionId: "s1",
      title: null,
      hasMore: true,
      messages: [
        { role: "user", text: "やあ", at: 1 },
        { role: "assistant", text: "", at: null, tools: ["aide_schedule"] },
      ],
    });
  });

  it("1件でも形が違えば応答全体を不正とする・別のセッションの応答は受け取らない", () => {
    assert.equal(parseHistoryBody({ ...ok, sessionId: "s2" }, "s1"), null);
    assert.equal(parseHistoryBody({ ...ok, hasMore: "yes" }, "s1"), null);
    assert.equal(parseHistoryBody({ ...ok, messages: [{ role: "tool", text: "x", at: 1 }] }, "s1"), null);
    assert.equal(parseHistoryBody({ ...ok, messages: [{ role: "user", text: "x", at: "1" }] }, "s1"), null);
    assert.equal(parseHistoryBody({ ...ok, messages: [{ role: "user", text: "x", at: 1, tools: [1] }] }, "s1"), null);
    assert.equal(parseHistoryBody(null, "s1"), null);
  });

  it("形が違う200は bad_response、404の no_session はそのまま", async () => {
    const respond = (status: number, body: unknown): typeof fetch => async () =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const bad = createHermesClient({ baseUrl: "http://x", token: "t", fetchImpl: respond(200, { messages: "x" }) });
    await assert.rejects(bad.history("s1"), (error: unknown) => error instanceof HermesError && error.kind === "bad_response");
    const missing = createHermesClient({ baseUrl: "http://x", token: "t", fetchImpl: respond(404, { error: "no_session" }) });
    await assert.rejects(missing.history("s1"), (error: unknown) => error instanceof HermesError && error.kind === "no_session");
  });
});
