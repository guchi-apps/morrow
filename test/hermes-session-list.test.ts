import assert from "node:assert/strict";
import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, describe, it } from "node:test";

import { createBridgeServer } from "../hermes-bridge/server.ts";
import { createSessionLister, projectSessions } from "../hermes-bridge/sessions.ts";
import { createHermesClient, HermesError, parseSessionList } from "@/lib/hermes/client-core";
import { sessionTitleFrom } from "@/lib/hermes/session-title";
import { lastActiveLabel, sessionLabel } from "@/lib/hermes/session-list-view";

const servers: Server[] = [];
after(() => {
  for (const s of servers) {
    s.closeAllConnections();
    s.close();
  }
});

describe("会話一覧の絞り込み（#1156）", () => {
  it("morrow以外・件数0・idの形が不正な行を落とし、本文・抜粋は載せない", () => {
    const rows = [
      { id: "m1", source: "morrow", title: " 引っ越し ", message_count: 12, last_active: 1700000000, started_at: 1, preview: "秘密の本文" },
      { id: "d1", source: "discord", title: "別の場所", message_count: 3, last_active: 1700000001 },
      { id: "m2", source: "morrow", title: null, message_count: 0, last_active: 1700000002 },
      { id: "..", source: "morrow", title: "x", message_count: 1 },
      { id: "m3", source: "morrow", title: "", message_count: 2, started_at: 1700000003 },
      "壊れた行",
    ];
    const out = projectSessions(rows);
    assert.deepEqual(out, [
      { sessionId: "m1", title: "引っ越し", lastActiveAt: 1700000000_000, messageCount: 12 },
      { sessionId: "m3", title: null, lastActiveAt: 1700000003_000, messageCount: 2 },
    ]);
    assert.ok(!JSON.stringify(out).includes("秘密"));
  });

  it("渡したidごとに /api/sessions/{id} を読み、Morrow以外・消えたidを外して新しい順に返す", async () => {
    const seen: { path: string; token: string | undefined }[] = [];
    const rows: Record<string, unknown> = {
      old: { id: "old", source: "morrow", title: "古い", message_count: 1, last_active: 5 },
      new: { id: "new", source: "morrow", title: "新しい", message_count: 2, last_active: 9 },
      disc: { id: "disc", source: "discord", title: "別", message_count: 2, last_active: 99 },
    };
    const hermes = createHttpServer((req, res) => {
      seen.push({ path: req.url ?? "", token: req.headers["x-hermes-session-token"] as string | undefined });
      const row = rows[(req.url ?? "").replace("/api/sessions/", "")];
      res.writeHead(row ? 200 : 404, { "content-type": "application/json" });
      res.end(JSON.stringify(row ?? { detail: "not found" }));
    });
    await new Promise<void>((r) => hermes.listen(0, "127.0.0.1", r));
    servers.push(hermes);
    const url = `http://127.0.0.1:${(hermes.address() as AddressInfo).port}`;
    const body = await createSessionLister({ url, token: "tok", timeoutMs: 2000 })(["old", "new", "disc", "gone", "..", "old"]);
    assert.deepEqual(body.sessions.map((x) => x.sessionId), ["new", "old"]);
    assert.equal(seen.length, 4); // 重複と不正なid（..）は読まない
    assert.ok(seen.every((r) => r.token === "tok"));
  });

  it("全部読めなかったときだけ失敗にする", async () => {
    const hermes = createHttpServer((_req, res) => {
      res.writeHead(500);
      res.end("{}");
    });
    await new Promise<void>((r) => hermes.listen(0, "127.0.0.1", r));
    servers.push(hermes);
    const url = `http://127.0.0.1:${(hermes.address() as AddressInfo).port}`;
    await assert.rejects(createSessionLister({ url, token: "t", timeoutMs: 2000 })(["a"]));
    assert.deepEqual((await createSessionLister({ url, token: "t", timeoutMs: 2000 })([])).sessions, []);
  });
});

describe("ブリッジの GET /sessions とクライアント", () => {
  async function start(sessions?: Parameters<typeof createBridgeServer>[0]["sessions"]) {
    const server = createBridgeServer({
      token: "t",
      allowedIps: ["100.64.0.9"],
      connect: async () => {
        throw new Error("使わない");
      },
      sessions,
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    servers.push(server);
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const fetchImpl: typeof fetch = (input, init) =>
      fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), "x-forwarded-for": "100.64.0.9" } });
    return { baseUrl, client: createHermesClient({ baseUrl, token: "t", fetchImpl }), fetchImpl };
  }

  it("渡したidを受けて一覧を返し、不正なidは400", async () => {
    const { client, baseUrl } = await start(async (ids) => ({
      sessions: ids.map((id) => ({ sessionId: id, title: null, lastActiveAt: null, messageCount: 1 })),
    }));
    assert.deepEqual((await client.listSessions(["a", "b"])).map((x) => x.sessionId), ["a", "b"]);
    assert.deepEqual(await client.listSessions([]), []);
    const headers = { authorization: "Bearer t", "x-forwarded-for": "100.64.0.9" };
    assert.equal((await fetch(`${baseUrl}/sessions?ids=a,..`, { headers })).status, 400);
    assert.equal((await fetch(`${baseUrl}/sessions?ids=${Array.from({ length: 101 }, (_, i) => `s${i}`).join(",")}`, { headers })).status, 400);
  });

  it("認証・送信元を既存の口と揃える", async () => {
    const { baseUrl } = await start(async () => ({ sessions: [] }));
    assert.equal((await fetch(`${baseUrl}/sessions`, { headers: { "x-forwarded-for": "100.64.0.9" } })).status, 401);
    assert.equal((await fetch(`${baseUrl}/sessions`, { headers: { authorization: "Bearer t", "x-forwarded-for": "1.2.3.4" } })).status, 403);
  });

  it("読み取りの失敗は503（hermes_down）、未設定も503", async () => {
    const { client } = await start(async () => {
      throw new Error("down");
    });
    await assert.rejects(client.listSessions(["a"]), (e: unknown) => e instanceof HermesError && e.kind === "hermes_down");
    const none = await start();
    await assert.rejects(none.client.listSessions(["a"]), (e: unknown) => e instanceof HermesError && e.kind === "hermes_down");
  });
});

describe("parseSessionList", () => {
  it("知っている項目だけで組み直し、1件でも形が違えばnull", () => {
    const ok = { sessions: [{ sessionId: "a", title: "t", lastActiveAt: 1, messageCount: 2.9, body: "余計" }] };
    assert.deepEqual(parseSessionList(ok), { sessions: [{ sessionId: "a", title: "t", lastActiveAt: 1, messageCount: 2 }] });
    assert.equal(parseSessionList({ sessions: [{ sessionId: "..", title: null, lastActiveAt: null, messageCount: 1 }] }), null);
    assert.equal(parseSessionList({ sessions: [{ sessionId: "a", title: 1, lastActiveAt: null, messageCount: 1 }] }), null);
    assert.equal(parseSessionList({}), null);
  });
});

describe("会話の題名と一覧の表示", () => {
  it("最初の行から30字までで作る", () => {
    assert.equal(sessionTitleFrom("\n\n 来週の   出張を\t組んで \n2行目"), "来週の 出張を 組んで");
    assert.equal(sessionTitleFrom("   "), undefined);
    const long = sessionTitleFrom("あ".repeat(50));
    assert.equal(Array.from(long ?? "").length, 30);
    assert.ok(long?.endsWith("…"));
  });

  it("題名なし・最終更新の言い方", () => {
    assert.equal(sessionLabel(null), "（題名なし）");
    assert.equal(sessionLabel("引っ越し"), "引っ越し");
    const now = Date.UTC(2026, 10, 23, 3, 0); // JST 12:00
    assert.equal(lastActiveLabel(Date.UTC(2026, 10, 23, 0, 40), now), "今日 09:40");
    assert.equal(lastActiveLabel(Date.UTC(2026, 10, 22, 12, 40), now), "昨日 21:40");
    assert.equal(lastActiveLabel(Date.UTC(2026, 10, 20, 3, 0), now), "11月20日");
    assert.equal(lastActiveLabel(null, now), "");
  });
});
