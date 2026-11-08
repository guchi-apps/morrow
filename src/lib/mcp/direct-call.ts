import { listConnectedServers, type ConnectedServer } from "@/lib/mcp/connections";
import { findPreset } from "@/lib/mcp/presets";
import { readMcpBody } from "@/lib/mcp/rpc-body";
import { toolErrorReason } from "@/lib/mcp/tool-error";

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
/** 書き込みの `tools/call` だけ長く待つ（Asset Managerの判定が重い回がある。`initialize` 等は8秒のまま。#709）。 */
const WRITE_CALL_TIMEOUT_MS = 30_000;

export class McpCallError extends Error {
  /** 道具が `isError` で返した、画面に出してよい短い理由（`reason`）。無ければnull。本文・スタックは含めない。 */
  readonly reason: string | null;
  constructor(message: string, reason: string | null = null) {
    super(message);
    this.reason = reason;
  }
}

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
  timeoutMs = REQUEST_TIMEOUT_MS,
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
    signal: AbortSignal.timeout(timeoutMs),
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
  return callTool(server, tool, args);
}

/**
 * 利用者が画面で承認した書き込みだけを通す、名指しの許可リスト（#689。メールの提案の実行）。
 * `callToolJson()` の「書き込みは断る」は変えず、ここに挙げた3本だけを呼べる別の入口にしてある。
 */
export const MAIL_FLOW_WRITE_TOOLS = ["aide_create_task", "aide_create_event", "asset_manager_import_payment"] as const;
export type MailFlowWriteTool = (typeof MAIL_FLOW_WRITE_TOOLS)[number];

export async function callWriteToolJson(
  server: ConnectedServer,
  tool: MailFlowWriteTool,
  args: Record<string, unknown>,
): Promise<ToolJson> {
  if (!(MAIL_FLOW_WRITE_TOOLS as readonly string[]).includes(tool)) {
    throw new McpCallError(`${tool} は許可していない書き込みの道具です`);
  }
  return callTool(server, tool, args, WRITE_CALL_TIMEOUT_MS);
}

/**
 * Hermesの提案（#748）を利用者が承認したあとだけ、Morrowのサーバーが呼ぶ書き込みの許可リスト。
 * メール用（上）とは型を分けてあり、広げても `callWriteToolJson()` の3本は変わらない。
 * `docs/hermes-actions.md` の「取り消せない書き込み」の表と揃える。
 */
export const HERMES_WRITE_TOOLS = [
  "aide_delete_event",
  "asset_manager_import_payment",
  "asset_manager_create_subscription",
  "asset_manager_add_subscription_price",
  "asset_manager_update_subscription",
  "asset_manager_record_subscription_cancellation",
] as const;
export type HermesWriteTool = (typeof HERMES_WRITE_TOOLS)[number];

export async function callHermesWriteToolJson(
  server: ConnectedServer,
  tool: HermesWriteTool,
  args: Record<string, unknown>,
): Promise<ToolJson> {
  if (!(HERMES_WRITE_TOOLS as readonly string[]).includes(tool)) {
    throw new McpCallError(`${tool} は許可していない書き込みの道具です`);
  }
  // 予定の削除は、承認の前の確認（`previewDeleteEvent()`）と同じ道具。ここでは**実行用**なので dryRun を持ち込ませない。
  if ("dryRun" in args) throw new McpCallError("実行用の呼び出しに dryRun は渡せません");
  return callTool(server, tool, args, WRITE_CALL_TIMEOUT_MS);
}

/**
 * 予定の削除の**確認だけ**（`dryRun: true`）。削除はしない。`dryRun` はここでリテラルに固定してあり、
 * 引数からは上書きできない（付け忘れると承認の前に予定が消えるため、実行用の入口と分けた）。
 */
export async function previewDeleteEvent(
  server: ConnectedServer,
  target: { eventId: string; calendarId: string; title: string },
): Promise<ToolJson> {
  return callTool(
    server,
    "aide_delete_event",
    { eventId: target.eventId, calendarId: target.calendarId, title: target.title, dryRun: true },
    WRITE_CALL_TIMEOUT_MS,
  );
}


async function callTool(
  server: ConnectedServer,
  tool: string,
  args: Record<string, unknown>,
  callTimeoutMs = REQUEST_TIMEOUT_MS,
): Promise<ToolJson> {

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
  }, callTimeoutMs);
  const result = resultOf(call.message, server.label);

  if (result.isError === true) {
    const reason = toolErrorReason(result);
    throw new McpCallError(`${tool} が失敗を返しました${reason ? `: ${reason}` : ""}`, reason);
  }

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
