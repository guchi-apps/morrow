import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { after, describe, it } from "node:test";

/**
 * 配布前の共有トークンの確認（`scripts/check-shared-tokens.sh`。#581）。
 * #570で `NOTICE_INGEST_TOKEN`・`OPS_API_TOKEN` を配らなくしたので、issue-deckに未登録のまま配ると
 * 受け口が401で閉じる。スクリプトの判定を、スタブのHTTPサーバーで確かめる。
 */

const ROOT = join(import.meta.dirname, "..");
const SECRET = "test-secret-value";

type Stub = { server: Server; url: string; seen: { url: string; auth: string | undefined; consumer: string | undefined }[] };

async function startStub(statusFor: (name: string) => number): Promise<Stub> {
  const seen: Stub["seen"] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://stub");
    seen.push({
      url: req.url ?? "",
      auth: req.headers.authorization,
      consumer: req.headers["x-shared-token-consumer"] as string | undefined,
    });
    res.statusCode = statusFor(url.searchParams.get("name") ?? "");
    res.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return { server, url: `http://127.0.0.1:${port}`, seen };
}

function run(env: Record<string, string>): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn("bash", [join(ROOT, "scripts", "check-shared-tokens.sh")], {
      env: { ...process.env, ...env },
    });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (out += chunk));
    child.on("close", (code) => resolve({ code, out }));
  });
}

const stubs: Stub[] = [];
after(() => {
  for (const stub of stubs) stub.server.close();
});

describe("scripts/check-shared-tokens.sh", () => {
  it("2つとも読めれば成功し、利用元 aide-bot として Bearer 付きで2つの名前を引く", async () => {
    const stub = await startStub(() => 200);
    stubs.push(stub);
    const result = await run({ SHARED_TOKEN_API_SECRET: SECRET, ISSUE_DECK_URL: `${stub.url}/` });
    assert.equal(result.code, 0, result.out);
    assert.deepEqual(
      stub.seen.map((entry) => entry.url),
      [
        "/api/shared-tokens?name=AIDE_BOT_NOTICE_INGEST_TOKEN",
        "/api/shared-tokens?name=OPS_API_TOKEN",
      ],
    );
    assert.ok(stub.seen.every((entry) => entry.auth === `Bearer ${SECRET}` && entry.consumer === "aide-bot"));
    assert.ok(!result.out.includes(SECRET), "Bearerの値を出力してはいけない");
  });

  it("片方が未登録（404）なら落ちて、名前を示す", async () => {
    const stub = await startStub((name) => (name === "OPS_API_TOKEN" ? 404 : 200));
    stubs.push(stub);
    const result = await run({ SHARED_TOKEN_API_SECRET: SECRET, ISSUE_DECK_URL: stub.url });
    assert.equal(result.code, 1);
    assert.match(result.out, /OPS_API_TOKEN.*未登録/);
    assert.match(result.out, /AIDE_BOT_NOTICE_INGEST_TOKEN: 読めました/);
  });

  it("認証に失敗（401）したら落ちる", async () => {
    const stub = await startStub(() => 401);
    stubs.push(stub);
    const result = await run({ SHARED_TOKEN_API_SECRET: SECRET, ISSUE_DECK_URL: stub.url });
    assert.equal(result.code, 1);
    assert.match(result.out, /SHARED_TOKEN_API_SECRET/);
  });

  it("接続先が空・届かないときも落ちる", async () => {
    assert.equal((await run({ SHARED_TOKEN_API_SECRET: SECRET, ISSUE_DECK_URL: "" })).code, 1);
    assert.equal((await run({ SHARED_TOKEN_API_SECRET: "", ISSUE_DECK_URL: "http://127.0.0.1:9" })).code, 1);
    const unreachable = await run({ SHARED_TOKEN_API_SECRET: SECRET, ISSUE_DECK_URL: "http://127.0.0.1:9" });
    assert.equal(unreachable.code, 1);
    assert.match(unreachable.out, /HTTP 000）/);
  });
});

describe("deploy.yml", () => {
  const code = readFileSync(join(ROOT, ".github", "workflows", "deploy.yml"), "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");

  it("何かをサーバーへ送る前に、共有トークンの確認を走らせる", () => {
    const check = code.indexOf("bash scripts/check-shared-tokens.sh");
    const upload = code.indexOf("name: Upload archive");
    assert.ok(check >= 0, "共有トークンの確認が無い");
    assert.ok(upload > check, "アーカイブを送った後に確認している");
  });
});
