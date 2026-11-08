import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

/**
 * 提案用の何もしないMCPサーバー（#737。`docs/hermes-actions.md`「取り消せない書き込みの提案と確認」）。
 *
 * 取り消せない書き込みはHermesに実行させず、`morrow_propose_action { tool, args, summary }` で提案だけを出させる。
 * この道具は**何もしない**（固定の文を返すだけ）。Morrowは同じターンのストリームの `tool.start`（名前と引数）から提案を読む。
 * ここに受け口の認証が要らないのは、127.0.0.1の専用ポートにだけバインドし、外（tailscale serve）へ出さないため
 * （ブリッジ本体のポートとは別のlistener）。Morrow専用profileの `mcp_servers` の接続先にする（#738の手作業）。
 *
 * MCPのStreamable HTTPのうち、`initialize`・`tools/list`・`tools/call` と通知だけに答える（SSEは使わない）。
 */

export const PROPOSE_TOOL_NAME = "morrow_propose_action";
export const PROPOSE_RESULT_TEXT = "提案を出しました。利用者の確認を待っています。実行済みとは言わないこと。";

const PROPOSE_TOOL = {
  name: PROPOSE_TOOL_NAME,
  description:
    "取り消せない操作（予定の削除・家計簿の登録・サブスクの登録や更新など）を、実行せずに利用者へ提案する。" +
    "この道具は何も実行しない。利用者がMorrowの画面で値を確認して承認したときに、Morrowが実行する。",
  inputSchema: {
    type: "object",
    properties: {
      tool: { type: "string", description: "実行したい道具の名前" },
      args: { type: "object", description: "その道具に渡す引数" },
      summary: { type: "string", description: "利用者に見せる一文の要約" },
    },
    required: ["tool", "args", "summary"],
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 1つのJSON-RPCメッセージへの応答。通知（`id` なし）は null。純粋。 */
export function proposeMcpResponse(message: unknown): Record<string, unknown> | null {
  if (!isRecord(message) || typeof message.method !== "string") return null;
  const id = message.id;
  if (id === undefined || id === null) return null; // 通知

  const reply = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  switch (message.method) {
    case "initialize": {
      const params = isRecord(message.params) ? message.params : {};
      return reply({
        protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "morrow-propose", version: "1.0.0" },
      });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: [PROPOSE_TOOL] });
    case "tools/call": {
      const params = isRecord(message.params) ? message.params : {};
      if (params.name !== PROPOSE_TOOL_NAME) {
        return { jsonrpc: "2.0", id, error: { code: -32602, message: "知らない道具" } };
      }
      return reply({ content: [{ type: "text", text: PROPOSE_RESULT_TEXT }], isError: false });
    }
    default:
      return { jsonrpc: "2.0", id, error: { code: -32601, message: "対応していないメソッド" } };
  }
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 64 * 1024) return null;
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

export function createProposeMcpServer(): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const fail = (status: number) => {
      res.writeHead(status);
      res.end();
    };
    if (req.method !== "POST" || new URL(req.url ?? "/", "http://x").pathname !== "/mcp") return fail(req.method === "POST" ? 404 : 405);
    readBody(req)
      .then((body) => {
        if (body === null) return fail(400);
        const messages = Array.isArray(body) ? body : [body];
        const responses = messages.map(proposeMcpResponse).filter((entry) => entry !== null);
        if (responses.length === 0) return fail(202); // 通知だけ
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(Array.isArray(body) ? responses : responses[0]));
      })
      .catch(() => fail(500));
  });
}
