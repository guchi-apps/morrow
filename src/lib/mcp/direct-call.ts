import { listConnectedServers, type ConnectedServer } from "@/lib/mcp/connections";
import { findPreset } from "@/lib/mcp/presets";
import { readMcpBody } from "@/lib/mcp/rpc-body";

/**
 * MCPの道具をモデルを通さずに1本呼ぶ（#573）。
 *
 * aide-botはMCPクライアントを実装しておらず、道具を呼ぶのはずっとCodexだった（#131）。
 * ダッシュボードの天気・予定は構造化JSONを返す道具をそのまま描くだけなので、Codexを挟むと
 * 数十秒待たされ利用枠も減る。**依存は足さず**、Streamable HTTPの最小の手順
 * （`initialize` → `notifications/initialized` → `tools/call`）だけをfetchで行う。
 *
 * - 応答は `application/json` と `text/event-stream`（SSE）のどちらでも読む（`readMcpBody()`）
 * - `Mcp-Session-Id` が返ればそれ以降に付ける。返らない（ステートレスな）サーバーでも通る
 * - **書き込みの道具は呼ばない。** 呼び出し側が名指しした読み取りの道具だけを想定している
 *   （`MCP_PRESETS` の `writeTools` に入っている名前は断る）
 */

const PROTOCOL_VERSION = "2025-06-18";
const REQUEST_TIMEOUT_MS = 8_000;

export class McpCallError extends Error {}

/** 結果のテキストをJSONとして読めたもの。読めなければ例外。 */
export type ToolJson = Record<string, unknown>;

/** プリセットのidで、いま使える接続を1つ選ぶ。無ければnull（未接続）。 */
export async function connectedServerFor(userId: string, presetId: string): Promise<ConnectedServer | null> {
  const servers = await listConnectedServers(userId);
  return servers.find((server) => findPreset(server.url)?.id === presetId) ?? null;
}

async function post(
  server: ConnectedServer,
  sessionId: string | null,
  body: unknown,
): Promise<{ sessionId: string | null; message: unknown }> {
  const response = await fetch(server.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${server.accessToken}`,
      "MCP-Protocol-Version": PROTOCOL_VERSION,
      ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok && response.status !== 202) {
    throw new McpCallError(`${server.label} が ${response.status} を返しました`);
  }

  const nextSession = response.headers.get("mcp-session-id") ?? sessionId;
  const text = await response.text();
  const message = text.trim() === "" ? null : readMcpBody(text, response.headers.get("content-type"));
  return { sessionId: nextSession, message };
}

function resultOf(message: unknown, label: string): Record<string, unknown> {
  if (!message || typeof message !== "object") throw new McpCallError(`${label} の応答を読めませんでした`);
  const record = message as Record<string, unknown>;
  if (record.error) {
    const detail = (record.error as { message?: unknown }).message;
    throw new McpCallError(`${label} がエラーを返しました: ${typeof detail === "string" ? detail : "不明"}`);
  }
  if (!record.result || typeof record.result !== "object") throw new McpCallError(`${label} の応答に結果がありません`);
  return record.result as Record<string, unknown>;
}

/**
 * 道具を1本呼び、結果の最初のテキストをJSONとして返す。
 *
 * AIDEの道具は `content[0].text` にJSON文字列を入れて返す（`structuredContent` があればそちらを使う）。
 * `isError` が立った回は失敗として投げる——「空だった」と混ぜない（#214）。
 */
export async function callToolJson(
  server: ConnectedServer,
  tool: string,
  args: Record<string, unknown> = {},
): Promise<ToolJson> {
  if (findPreset(server.url)?.writeTools.includes(tool)) {
    throw new McpCallError(`${tool} は書き込みの道具なので、ここからは呼びません`);
  }

  const init = await post(server, null, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "aide-bot-dashboard", version: "1" },
    },
  });
  resultOf(init.message, server.label);

  await post(server, init.sessionId, { jsonrpc: "2.0", method: "notifications/initialized" });

  const call = await post(server, init.sessionId, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: tool, arguments: args },
  });
  const result = resultOf(call.message, server.label);

  if (result.isError === true) throw new McpCallError(`${tool} が失敗を返しました`);

  if (result.structuredContent && typeof result.structuredContent === "object") {
    return result.structuredContent as ToolJson;
  }

  const content = Array.isArray(result.content) ? result.content : [];
  const text = content.find(
    (item): item is { type: "text"; text: string } =>
      !!item && typeof item === "object" && (item as { type?: unknown }).type === "text" &&
      typeof (item as { text?: unknown }).text === "string",
  )?.text;
  if (!text) throw new McpCallError(`${tool} の結果にテキストがありません`);

  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not object");
    return parsed as ToolJson;
  } catch {
    throw new McpCallError(`${tool} の結果をJSONとして読めませんでした`);
  }
}
