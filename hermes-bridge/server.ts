import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  HEARTBEAT_MS,
  HISTORY_DEFAULT_LIMIT,
  HISTORY_MAX_LIMIT,
  SESSION_LIST_MAX_LIMIT,
  MAX_CONCURRENT_TURNS,
  SESSION_ID_PATTERN,
  TURN_TIMEOUT_MS,
  isApprovalChoice,
  isPathSafeSessionId,
  type BridgeErrorReason,
  type BridgeEvent,
  type HealthBody,
  type TurnRequestBody,
} from "../src/lib/hermes/contract.ts";
import { parseTurnImages, TURN_BODY_MAX_BYTES_WITH_IMAGES } from "../src/lib/hermes/image-core.ts";
import { aideHealthFromStatus, type AideHealth } from "../src/lib/hermes/aide-health.ts";
import { authorize, parseAllowedIps } from "./auth.ts";
import { connectHermes, type HermesLink } from "./hermes-link.ts";
import { createHistoryReader, HistoryNotFoundError, type HistoryReader } from "./history.ts";
import { createSessionLister, type SessionLister } from "./sessions.ts";
import { createMemoryStore, MemoryConflictError, MemoryNotFoundError, MemoryRejectedError, type MemoryStore } from "./memory.ts";
import { createSkillStore, SkillNotFoundError, SkillRejectedError, type SkillStore } from "./skills.ts";
import { TurnLimiter } from "./limits.ts";
import { createProposeMcpServer } from "./propose-mcp.ts";
import { NoSessionError, openSession, runTurn, type TurnHandle } from "./turn.ts";

/**
 * morrow-hermes-bridge（#737。設計は `docs/hermes-route.md`）。
 *
 * subpcの127.0.0.1で動く小さなHTTPサーバー。`tailscale serve` の裏に置き、Hermesのメソッドのうち
 * チャットに要るもの（ターンの開始・承認の回答・中断・履歴の読み取り）だけを通す。Hermesのトークンはここから出さない。
 */

export interface BridgeOptions {
  /** `MORROW_HERMES_BRIDGE_TOKEN`。未設定（空）なら全部401。 */
  token: string | undefined;
  /** `MORROW_HERMES_BRIDGE_ALLOWED_IPS` を分けたもの。空なら全部403。 */
  allowedIps: string[];
  /** Hermesへ繋ぐ関数（テストでは差し替える）。 */
  connect: () => Promise<HermesLink>;
  /** 会話の履歴を読む関数（#752。テストでは差し替える）。未指定なら履歴は503。 */
  history?: HistoryReader;
  /** 会話の一覧を読む関数（#1156。テストでは差し替える）。未指定なら一覧は503。 */
  sessions?: SessionLister;
  /** Hermesが作るスキルの確認・承認（#1154。テストでは差し替える）。未指定ならスキルの口は503。 */
  skills?: SkillStore;
  /** 記憶の確認・承認（#1155）。 */
  memory?: MemoryStore;
  turnTimeoutMs?: number;
  heartbeatMs?: number;
  maxConcurrent?: number;
}

const MAX_BODY_BYTES = 64 * 1024;
const MAX_TEXT_LENGTH = 20_000;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(text);
}

function sendError(res: ServerResponse, status: number, reason: BridgeErrorReason, message?: string): void {
  sendJson(res, status, { error: reason, ...(message ? { message } : {}) });
}

async function readJson(req: IncomingMessage, maxBytes: number = MAX_BODY_BYTES): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) return null;
    chunks.push(chunk as Buffer);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function formatSse(event: BridgeEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

function parseTurnBody(body: Record<string, unknown>): TurnRequestBody | null {
  const { text, sessionId, title, images } = body;
  if (typeof text !== "string" || text.trim() === "" || text.length > MAX_TEXT_LENGTH) return null;
  if (sessionId !== undefined && (typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId))) return null;
  if (title !== undefined && (typeof title !== "string" || title.length > 200)) return null;
  const parsedImages = parseTurnImages(images);
  if (!parsedImages) return null;
  return { text, ...(sessionId ? { sessionId } : {}), ...(title ? { title } : {}), ...(parsedImages.length > 0 ? { images: parsedImages } : {}) };
}

export function createBridgeServer(options: BridgeOptions): Server {
  const limiter = new TurnLimiter(options.maxConcurrent ?? MAX_CONCURRENT_TURNS);
  const turns = new Map<string, TurnHandle>();
  const turnTimeoutMs = options.turnTimeoutMs ?? TURN_TIMEOUT_MS;
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;

  async function handleHealth(res: ServerResponse): Promise<void> {
    let hermes: HealthBody["hermes"] = "down";
    let aide: AideHealth | null = null;
    try {
      const link = await options.connect();
      hermes = "ok";
      try {
        // キャッシュ済みの状態を読むだけ（接続も認証も始めない）。古いHermesでメソッドが無い・形が読めない回は無しのまま
        aide = aideHealthFromStatus(await link.rpc("mcp.servers.status", {}));
      } catch {
        // 判定できない
      }
      link.close();
    } catch {
      // 繋がらない
    }
    const body: HealthBody = { bridge: "ok", hermes, ...(aide ? { aide } : {}) };
    sendJson(res, 200, body);
  }

  async function handleStartTurn(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // 画像つきの本文はこの口だけ大きく受ける（#1157）。他の口は64KBのまま
    const raw = await readJson(req, TURN_BODY_MAX_BYTES_WITH_IMAGES);
    const body = raw ? parseTurnBody(raw) : null;
    if (!body) return sendError(res, 400, "bad_request");

    const releaseSlot = limiter.acquireSlot();
    if (releaseSlot === "bridge_busy") return sendError(res, 429, "bridge_busy");

    let releaseSession: (() => void) | undefined;
    let link: HermesLink | undefined;
    const cleanup = () => {
      link?.close();
      releaseSession?.();
      releaseSlot();
    };

    try {
      if (body.sessionId) {
        const acquired = limiter.acquireSession(body.sessionId);
        if (acquired === "session_busy") {
          releaseSlot();
          return sendError(res, 409, "session_busy");
        }
        releaseSession = acquired;
      }

      try {
        link = await options.connect();
      } catch {
        cleanup();
        return sendError(res, 503, "hermes_down");
      }

      let session;
      try {
        session = await openSession(link, body);
      } catch (error) {
        cleanup();
        if (error instanceof NoSessionError) return sendError(res, 404, "no_session");
        return sendError(res, 503, "hermes_down");
      }

      // 新規セッションの保存idは、この時点で初めて分かる。続きの指示と衝突しないよう枠を取る
      if (!body.sessionId) {
        const acquired = limiter.acquireSession(session.storedId);
        if (acquired === "session_busy") {
          cleanup();
          return sendError(res, 409, "session_busy");
        }
        releaseSession = acquired;
      }

      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });

      const turnId = randomUUID();
      const emit = (event: BridgeEvent) => {
        if (!res.writableEnded) res.write(formatSse(event));
      };
      emit({ type: "turn", data: { turnId, sessionId: session.storedId } });

      const handle = runTurn({ link, session, text: body.text, images: body.images, emit, timeoutMs: turnTimeoutMs });
      turns.set(turnId, handle);

      const heartbeat = setInterval(() => {
        if (!res.writableEnded) res.write(": ping\n\n");
      }, heartbeatMs);

      // 切断されたら中断する（承認待ちは拒否で終わる）。続きを追いかける形は未試験なので、安全側に倒す
      let finished = false;
      res.on("close", () => {
        if (!finished) void handle.interrupt();
      });

      await handle.done;
      finished = true;
      clearInterval(heartbeat);
      turns.delete(turnId);
      cleanup();
      if (!res.writableEnded) res.end();
    } catch (error) {
      console.error("[morrow-hermes-bridge] ターンの処理に失敗した", error instanceof Error ? error.message : error);
      cleanup();
      if (!res.headersSent) sendError(res, 500, "hermes_error");
      else if (!res.writableEnded) res.end();
    }
  }

  async function handleTurnAction(
    req: IncomingMessage,
    res: ServerResponse,
    turnId: string,
    action: "approval" | "interrupt" | "clarify",
  ): Promise<void> {
    const handle = turns.get(turnId);
    if (!handle) return sendError(res, 404, "turn_not_found");

    if (action === "interrupt") {
      await handle.interrupt();
      return sendJson(res, 200, { ok: true });
    }

    if (action === "clarify") {
      // 選択肢つきの質問への回答（#1150）。質問のidと選択肢に合う形だけ通す
      const body = await readJson(req);
      if (!body || typeof body.requestId !== "string") return sendError(res, 400, "bad_request");
      const outcome = handle.respondClarify(body.requestId, body.answers);
      if (outcome === "invalid") return sendError(res, 400, "bad_request");
      if (outcome === "not_found") return sendError(res, 404, "turn_not_found", "待っている質問がありません");
      return sendJson(res, 200, { ok: true });
    }

    const body = await readJson(req);
    if (!body || typeof body.requestId !== "string" || !isApprovalChoice(body.choice)) {
      // `always`・`session` はここで落ちる（profileの許可リストに書き込まれ、以後の確認が消えるため）
      return sendError(res, 400, "bad_request");
    }
    try {
      const accepted = await handle.respondApproval(body.requestId, body.choice);
      if (!accepted) return sendError(res, 404, "turn_not_found", "待っている承認がありません");
      sendJson(res, 200, { ok: true });
    } catch {
      sendError(res, 503, "hermes_down");
    }
  }

  /** `GET /sessions/<id>/messages?limit=N`（#752）。Morrowのセッションだけを、表示に要る項目に絞って返す。 */
  async function handleHistory(res: ServerResponse, sessionId: string, rawLimit: string | null): Promise<void> {
    if (!isPathSafeSessionId(sessionId)) return sendError(res, 400, "bad_request");
    let limit = HISTORY_DEFAULT_LIMIT;
    if (rawLimit !== null) {
      if (!/^\d{1,3}$/.test(rawLimit)) return sendError(res, 400, "bad_request");
      limit = Number(rawLimit);
      if (limit < 1 || limit > HISTORY_MAX_LIMIT) return sendError(res, 400, "bad_request");
    }
    if (!options.history) return sendError(res, 503, "hermes_down");
    try {
      sendJson(res, 200, await options.history(sessionId, limit));
    } catch (error) {
      if (error instanceof HistoryNotFoundError) return sendError(res, 404, "no_session");
      console.error("[morrow-hermes-bridge] 履歴の取得に失敗した", error instanceof Error ? error.message : error);
      sendError(res, 503, "hermes_down");
    }
  }

  /** `GET /sessions?ids=a,b,c`（#1156）。渡されたMorrowのセッションの題名・最終更新・件数だけ（最近動いた順）。 */
  async function handleSessionList(res: ServerResponse, rawIds: string | null): Promise<void> {
    const ids = rawIds === null || rawIds === "" ? [] : rawIds.split(",");
    if (ids.length > SESSION_LIST_MAX_LIMIT || !ids.every(isPathSafeSessionId)) return sendError(res, 400, "bad_request");
    if (!options.sessions) return sendError(res, 503, "hermes_down");
    try {
      sendJson(res, 200, await options.sessions(ids));
    } catch (error) {
      console.error("[morrow-hermes-bridge] 会話一覧の取得に失敗した", error instanceof Error ? error.message : error);
      sendError(res, 503, "hermes_down");
    }
  }

  /** スキルの口（#1154）。保留の一覧・承認・却下、登録済みの一覧・削除。 */
  async function handleSkills(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
    const pendingAction = /^\/skills\/pending\/([0-9a-f]{8})\/(approve|discard)$/.exec(pathname);
    const installed = /^\/skills\/installed\/([^/]+)$/.exec(pathname);
    const isRoute = pathname === "/skills/pending" || pathname === "/skills/installed" || pendingAction || installed;
    if (!isRoute) return false;
    const skills = options.skills;
    if (!skills) {
      // Hermesは動いている。設定漏れを「Hermesが応答しません」と取り違えさせない（#1225）
      sendError(res, 503, "feature_disabled");
      return true;
    }
    try {
      if (req.method === "GET" && pathname === "/skills/pending") sendJson(res, 200, { pending: await skills.listPending() });
      else if (req.method === "GET" && pathname === "/skills/installed") sendJson(res, 200, { skills: await skills.listInstalled() });
      else if (req.method === "POST" && pendingAction) {
        if (pendingAction[2] === "approve") await skills.approve(pendingAction[1]);
        else await skills.discard(pendingAction[1]);
        sendJson(res, 200, { ok: true });
      } else if (req.method === "DELETE" && installed) {
        let name: string;
        try {
          name = decodeURIComponent(installed[1]);
        } catch {
          sendError(res, 400, "bad_request");
          return true;
        }
        await skills.removeInstalled(name);
        sendJson(res, 200, { ok: true });
      } else sendJson(res, 404, { error: "not_found" });
    } catch (error) {
      if (error instanceof SkillNotFoundError) sendError(res, 404, "skill_not_found");
      else if (error instanceof SkillRejectedError) sendError(res, 409, "skill_rejected", error.message);
      else {
        console.error("[morrow-hermes-bridge] スキルの処理に失敗した", error instanceof Error ? error.message : error);
        sendError(res, 503, "hermes_down");
      }
    }
    return true;
  }

  /** 記憶の口（#1155）。保留の一覧・承認・却下、保存済みの一覧・1項目の削除。 */
  async function handleMemory(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
    const pendingAction = /^\/memory\/pending\/([0-9a-f]{8})\/(approve|discard)$/.exec(pathname);
    const isRoute = pathname === "/memory/pending" || pathname === "/memory/entries" || pendingAction;
    if (!isRoute) return false;
    const memory = options.memory;
    if (!memory) {
      sendError(res, 503, "feature_disabled");
      return true;
    }
    try {
      if (req.method === "GET" && pathname === "/memory/pending") sendJson(res, 200, { pending: await memory.listPending() });
      else if (req.method === "GET" && pathname === "/memory/entries") sendJson(res, 200, { entries: await memory.listEntries() });
      else if (req.method === "POST" && pendingAction) {
        if (pendingAction[2] === "approve") await memory.approve(pendingAction[1]);
        else await memory.discard(pendingAction[1]);
        sendJson(res, 200, { ok: true });
      } else if (req.method === "DELETE" && pathname === "/memory/entries") {
        const body = await readJson(req);
        const target = body?.target;
        const text = body?.text;
        if ((target !== "user" && target !== "memory") || typeof text !== "string" || text.trim() === "") {
          sendError(res, 400, "bad_request");
          return true;
        }
        await memory.removeEntry(target, text);
        sendJson(res, 200, { ok: true });
      } else sendJson(res, 404, { error: "not_found" });
    } catch (error) {
      if (error instanceof MemoryNotFoundError) sendError(res, 404, "memory_not_found");
      else if (error instanceof MemoryConflictError) sendError(res, 409, "memory_rejected", "記憶が同時に更新されました。画面を開き直してもう一度試してください。");
      else if (error instanceof MemoryRejectedError) sendError(res, 409, "memory_rejected", error.message);
      else {
        console.error("[morrow-hermes-bridge] 記憶の処理に失敗した", error instanceof Error ? error.message : error);
        sendError(res, 503, "hermes_down");
      }
    }
    return true;
  }

  return createServer((req, res) => {
    const verdict = authorize({
      authorization: req.headers.authorization,
      forwardedFor: req.headers["x-forwarded-for"],
      token: options.token,
      allowedIps: options.allowedIps,
    });
    if (verdict === "unauthorized") return sendError(res, 401, "unauthorized");
    if (verdict === "forbidden") return sendError(res, 403, "forbidden");

    const url = new URL(req.url ?? "/", "http://bridge");
    const route = (async () => {
      if (req.method === "GET" && url.pathname === "/health") return handleHealth(res);
      if (await handleSkills(req, res, url.pathname)) return;
      if (await handleMemory(req, res, url.pathname)) return;
      if (req.method === "POST" && url.pathname === "/turns") return handleStartTurn(req, res);
      if (req.method === "GET" && url.pathname === "/sessions") return handleSessionList(res, url.searchParams.get("ids"));
      const historyMatch = /^\/sessions\/([^/]+)\/messages$/.exec(url.pathname);
      if (req.method === "GET" && historyMatch) {
        let sessionId: string;
        try {
          sessionId = decodeURIComponent(historyMatch[1]);
        } catch {
          return sendError(res, 400, "bad_request");
        }
        return handleHistory(res, sessionId, url.searchParams.get("limit"));
      }
      const match = /^\/turns\/([\w-]{1,64})\/(approval|interrupt|clarify)$/.exec(url.pathname);
      if (req.method === "POST" && match) return handleTurnAction(req, res, match[1], match[2] as "approval" | "interrupt" | "clarify");
      sendJson(res, 404, { error: "not_found" });
    })();
    route.catch((error: unknown) => {
      console.error("[morrow-hermes-bridge] リクエストの処理に失敗した", error instanceof Error ? error.message : error);
      if (!res.headersSent) sendError(res, 500, "hermes_error");
      else if (!res.writableEnded) res.end();
    });
  });
}

/** 環境変数から起動する。`node hermes-bridge/server.ts`（systemdのunitから）。 */
function main(): void {
  const hermesUrl = process.env.HERMES_URL ?? "";
  const hermesToken = process.env.HERMES_DASHBOARD_SESSION_TOKEN ?? "";
  const port = Number(process.env.MORROW_HERMES_BRIDGE_PORT ?? "");
  if (!hermesUrl || !hermesToken || !Number.isInteger(port) || port <= 0) {
    console.error("HERMES_URL・HERMES_DASHBOARD_SESSION_TOKEN・MORROW_HERMES_BRIDGE_PORT が必要です");
    process.exit(1);
  }
  const token = process.env.MORROW_HERMES_BRIDGE_TOKEN;
  const allowedIps = parseAllowedIps(process.env.MORROW_HERMES_BRIDGE_ALLOWED_IPS);
  if (!token) console.warn("MORROW_HERMES_BRIDGE_TOKEN が未設定のため、すべてのリクエストを401で断ります");
  if (allowedIps.length === 0) console.warn("MORROW_HERMES_BRIDGE_ALLOWED_IPS が空のため、すべてのリクエストを403で断ります");

  const server = createBridgeServer({
    token,
    allowedIps,
    connect: () => connectHermes({ url: hermesUrl, token: hermesToken, timeoutMs: 3_000 }),
    history: createHistoryReader({ url: hermesUrl, token: hermesToken, timeoutMs: 5_000 }),
    sessions: createSessionLister({ url: hermesUrl, token: hermesToken, timeoutMs: 5_000 }),
    // スキルの確認・承認（#1154）。profileのディレクトリが分からなければ立てない（口は503）
    skills: process.env.MORROW_HERMES_HOME
      ? createSkillStore({ hermesHome: process.env.MORROW_HERMES_HOME, connect: () => connectHermes({ url: hermesUrl, token: hermesToken, timeoutMs: 3_000 }) })
      : undefined,
    // 記憶の確認・承認（#1155）。スキルと同じく profile のディレクトリが要る
    memory: process.env.MORROW_HERMES_HOME
      ? createMemoryStore({ hermesHome: process.env.MORROW_HERMES_HOME, connect: () => connectHermes({ url: hermesUrl, token: hermesToken, timeoutMs: 3_000 }) })
      : undefined,
  });
  if (!process.env.MORROW_HERMES_HOME) console.warn("MORROW_HERMES_HOME が未設定のため、スキル・記憶の確認・承認の口は503を返します");
  // tailscale serve からはループバックでしか届かない。外へバインドしない
  server.listen(port, "127.0.0.1", () => console.log(`morrow-hermes-bridge: 127.0.0.1:${port}`));

  // 提案用のMCP（何もしない道具）。外へ出さない別のポート。未設定なら立てない
  const proposePort = Number(process.env.MORROW_HERMES_PROPOSE_MCP_PORT ?? "");
  if (Number.isInteger(proposePort) && proposePort > 0) {
    createProposeMcpServer().listen(proposePort, "127.0.0.1", () => console.log(`morrow-propose-mcp: 127.0.0.1:${proposePort}/mcp`));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
