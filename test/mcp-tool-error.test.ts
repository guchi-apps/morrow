import assert from "node:assert/strict";
import { test } from "node:test";

import { buildAuthorizeUrl } from "../src/lib/mcp/oauth.ts";
import { MCP_PRESETS } from "../src/lib/mcp/presets.ts";
import { MISSING_SCOPE_REASON, toolErrorReason } from "../src/lib/mcp/tool-error.ts";

const text = (value: string) => ({ content: [{ type: "text", text: value }], isError: true });

test("JSONの reason はそのまま（改行を畳んで）返す", () => {
  assert.equal(toolErrorReason(text(JSON.stringify({ ok: false, reason: "place は\n必須です" }))), "place は 必須です");
  assert.equal(toolErrorReason({ structuredContent: { reason: "HTTP 400" }, isError: true }), "HTTP 400");
});

test("AIDEのscope不足の断り（#788）は繋ぎ直しを促す文になる", () => {
  const result = text("ツール aide_create_task には tasks:write の認可が必要です。再接続して明示的に許可してください。");
  assert.equal(toolErrorReason(result), MISSING_SCOPE_REASON);
});

test("理由の無い失敗・例外の本文は出さない", () => {
  assert.equal(toolErrorReason(text("ツール aide_create_task が失敗しました: TypeError at foo.ts:1")), null);
  assert.equal(toolErrorReason({ isError: true }), null);
  assert.equal(toolErrorReason(text(JSON.stringify({ ok: false, reason: "  " }))), null);
});

test("AIDEへ繋ぐときは tasks:read・tasks:write と kurashio-bills:read・write を求める（#788・#922・#1100）", () => {
  const aide = MCP_PRESETS.find((p) => p.id === "aide")!;
  // aide_tasks（紐づけの候補）は tasks:read、aide_create_task は tasks:write。AIDEは write で read を兼ねない
  //（aide の src/mcp/tools/tasks.ts の requiredScopes。2026-11-15に確認）。
  assert.deepEqual(aide.scopes, ["tasks:read", "tasks:write", "kurashio-bills:read", "kurashio-bills:write"]);
  const url = new URL(
    buildAuthorizeUrl({
      authorizationEndpoint: "https://aide.example/authorize",
      clientId: "c",
      redirectUri: "https://morrow.example/cb",
      state: "s",
      challenge: "x",
      resource: aide.url,
      scopes: aide.scopes,
    }),
  );
  assert.equal(url.searchParams.get("scope"), "tasks:read tasks:write kurashio-bills:read kurashio-bills:write");
});

test("scopeを持たない接続先では scope を付けない", () => {
  const url = new URL(
    buildAuthorizeUrl({
      authorizationEndpoint: "https://x.example/authorize",
      clientId: "c",
      redirectUri: "https://morrow.example/cb",
      state: "s",
      challenge: "x",
      resource: "https://x.example/mcp",
    }),
  );
  assert.equal(url.searchParams.has("scope"), false);
});
