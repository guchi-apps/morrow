import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, describe, it } from "node:test";

import { classifyFailure, createHermesClient, HermesError } from "@/lib/hermes/client-core";
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
    assert.equal(kind(404, "no_session"), "no_session");
    assert.equal(kind(409, "session_busy"), "session_busy");
    assert.equal(kind(429, "bridge_busy"), "bridge_busy");
    assert.equal(kind(500), "bad_response");
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

  it("Bearerを付けて呼び、接続のタイムアウトはストリーム本文には掛からない", async () => {
    const seen: { auth: string | undefined }[] = [];
    const server = createServer((req, res) => {
      seen.push({ auth: req.headers.authorization });
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('event: turn\ndata: {"turnId":"t","sessionId":"s"}\n\n');
      setTimeout(() => {
        res.write('event: message.complete\ndata: {"text":"ok"}\n\n');
        res.end();
      }, 80);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    after(() => server.close());
    const { port } = server.address() as AddressInfo;
    const client = createHermesClient({ baseUrl: `http://127.0.0.1:${port}`, token: "secret-t", connectTimeoutMs: 40 });
    const types: string[] = [];
    for await (const event of await client.startTurn({ text: "x" })) types.push(event.type);
    assert.deepEqual(types, ["turn", "message.complete"]);
    assert.equal(seen[0].auth, "Bearer secret-t");
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
