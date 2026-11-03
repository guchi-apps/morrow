import { NextResponse } from "next/server";

import { APP_VERSION } from "@/lib/app-version";
import { hasValidBearer } from "@/lib/bearer-auth";
import { isJsonObject } from "@/lib/json-body";
import { createTask, deleteTask, describeTaskError, listTasks, updateTask } from "@/lib/notion-tasks";
import {
  normalizeTaskId,
  parseTaskCreate,
  parseTaskPatch,
  TASK_MEMO_MAX,
  TASK_PRIORITIES,
  TASK_REPEATS,
  TASK_STATUSES,
  TASK_TAGS,
  TASK_TITLE_MAX,
} from "@/lib/task-input";

export const dynamic = "force-dynamic";

const PROTOCOL_VERSION = "2025-06-18";

type JsonRpcRequest = {
  jsonrpc?: unknown;
  id?: string | number | null;
  method?: unknown;
  params?: unknown;
};

const DATE_NOTE = "YYYY-MM-DD か、タイムゾーン付きのISO 8601（例: 2026-09-30T09:00:00+09:00）。";

/** タスクの項目（`task-input.ts` と同じ。ここに書く選択肢は検証と同じ定数から出す）。 */
const TASK_FIELDS = {
  title: { type: "string", maxLength: TASK_TITLE_MAX, description: "タスクの題名" },
  memo: { type: ["string", "null"], maxLength: TASK_MEMO_MAX, description: "メモ。null か空文字で消す" },
  tags: { type: "array", items: { type: "string", enum: [...TASK_TAGS] }, description: "タグ。渡すと置き換える" },
  priority: { type: ["string", "null"], enum: [...TASK_PRIORITIES, null] },
  plannedDate: { type: ["string", "null"], description: `予定日（自分で決めた実行予定日）。${DATE_NOTE}` },
  dueDate: { type: ["string", "null"], description: `期限（締切）。${DATE_NOTE}` },
  repeat: { type: ["string", "null"], enum: [...TASK_REPEATS, null] },
  done: { type: "boolean", description: "完了" },
  status: { type: ["string", "null"], enum: [...TASK_STATUSES, null], description: "対応状況" },
} as const;

const TASK_ID = {
  type: "string",
  description: "NotionのタスクのページID（aide_task_list の id）。Task DB以外のページは受け付けない",
} as const;

/** Notionの「Task」DBを直接管理するツール（#373）。宛先の利用者は無く、`TASK_API_TOKEN` のBearerで認証した呼び出し元がそのまま操作する。 */
const TASK_TOOLS = [
  {
    name: "aide_task_list",
    description: "Notionの「Task」DBのタスクを一覧します。done で完了・未完了を絞れます。",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        done: { type: "boolean", description: "true=完了だけ、false=未完了だけ。省略で全部" },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "件数（既定50）" },
        cursor: { type: "string", description: "前回の nextCursor。続きを取るとき" },
      },
    },
  },
  {
    name: "aide_task_create",
    description: "Notionの「Task」DBへタスクを1件追加します。title だけが必須です。",
    inputSchema: { type: "object", additionalProperties: false, properties: TASK_FIELDS, required: ["title"] },
  },
  {
    name: "aide_task_update",
    description: "Notionの「Task」DBのタスクを編集します。渡した項目だけを書き換え、null は「空にする」です。",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { id: TASK_ID, ...TASK_FIELDS },
      required: ["id"],
    },
  },
  {
    name: "aide_task_delete",
    description:
      "Notionの「Task」DBのタスクをゴミ箱へ移します（Notion上から戻せます）。確認なしで実行されるので、呼ぶ前に利用者へ確かめてください。",
    inputSchema: { type: "object", additionalProperties: false, properties: { id: TASK_ID }, required: ["id"] },
  },
] as const;

function response(id: JsonRpcRequest["id"], result: unknown) {
  return NextResponse.json(
    { jsonrpc: "2.0", id: id ?? null, result },
    { headers: { "MCP-Protocol-Version": PROTOCOL_VERSION } },
  );
}

function errorResponse(id: JsonRpcRequest["id"], code: number, message: string) {
  return NextResponse.json(
    { jsonrpc: "2.0", id: id ?? null, error: { code, message } },
    { headers: { "MCP-Protocol-Version": PROTOCOL_VERSION } },
  );
}

function textResult(text: string, isError = false) {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

async function callTaskTool(name: string, args: Record<string, unknown>) {
  try {
    if (name === "aide_task_list") {
      if (args.done !== undefined && typeof args.done !== "boolean") return textResult("done は true か false で指定してください。", true);
      const limit = args.limit;
      if (limit !== undefined && (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 100)) {
        return textResult("limit は1〜100の整数で指定してください。", true);
      }
      const cursor = typeof args.cursor === "string" ? args.cursor : undefined;
      return textResult(JSON.stringify(await listTasks({ done: args.done as boolean | undefined, limit, cursor })));
    }

    if (name === "aide_task_create") {
      const parsed = parseTaskCreate(args);
      if (!parsed.ok) return textResult(parsed.error, true);
      return textResult(JSON.stringify({ task: await createTask(parsed.value) }));
    }

    const { id: rawId, ...rest } = args;
    const id = normalizeTaskId(rawId);
    if (!id) return textResult("id はNotionのタスクのページIDで指定してください。", true);

    if (name === "aide_task_update") {
      const parsed = parseTaskPatch(rest);
      if (!parsed.ok) return textResult(parsed.error, true);
      return textResult(JSON.stringify({ task: await updateTask(id, parsed.value) }));
    }

    await deleteTask(id);
    return textResult(JSON.stringify({ deleted: true, id }));
  } catch (error) {
    return textResult(describeTaskError(error).message, true);
  }
}

async function callTool(name: string, rawArgs: unknown) {
  if (!TASK_TOOLS.some((tool) => tool.name === name)) return textResult(`未知のツールです: ${name}`, true);
  if (rawArgs !== undefined && (typeof rawArgs !== "object" || rawArgs === null || Array.isArray(rawArgs))) {
    return textResult("arguments はJSONオブジェクトで指定してください。", true);
  }
  return callTaskTool(name, (rawArgs ?? {}) as Record<string, unknown>);
}

export async function POST(request: Request) {
  // ツールはNotionのタスク（`aide_task_*`）だけ。`TASK_API_TOKEN` のBearerで通し、未設定なら経路ごと401で閉じる。
  // お知らせの3ツール（`aide_create_notification` ほか）と `NOTICE_INGEST_TOKEN` での認証は#663で廃止した。
  const taskAllowed = hasValidBearer(request.headers.get("authorization"), process.env.TASK_API_TOKEN);
  if (!taskAllowed) return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "JSONとして読めませんでした。" }, { status: 400 });
  }

  // 本文が `null` だと `body.jsonrpc` を読んだ時点でTypeErrorになり、呼ぶ側には500しか見えない（#262）。
  // JSONとして読めたが形が違うものは、JSON-RPCのエラーで返す（`id` は取れないのでnull）。
  if (!isJsonObject(raw)) return errorResponse(null, -32600, "JSON-RPCリクエストが不正です。");
  const body: JsonRpcRequest = raw;

  if (body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return errorResponse(body.id, -32600, "JSON-RPCリクエストが不正です。");
  }

  if (body.method === "notifications/initialized") return new NextResponse(null, { status: 202 });
  if (body.method === "ping") return response(body.id, {});
  if (body.method === "initialize") {
    return response(body.id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "aide-bot", version: APP_VERSION },
    });
  }
  if (body.method === "tools/list") {
    return response(body.id, { tools: TASK_TOOLS });
  }
  if (body.method === "tools/call") {
    if (typeof body.params !== "object" || body.params === null) return errorResponse(body.id, -32602, "params が要ります。");
    const params = body.params as Record<string, unknown>;
    if (typeof params.name !== "string") return errorResponse(body.id, -32602, "ツール名が要ります。");
    return response(body.id, await callTool(params.name, params.arguments));
  }

  return errorResponse(body.id, -32601, `未対応のメソッドです: ${body.method}`);
}
