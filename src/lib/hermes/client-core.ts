import {
  CONNECT_TIMEOUT_MS,
  HISTORY_DEFAULT_LIMIT,
  HISTORY_MAX_LIMIT,
  type ApprovalChoice,
  type BridgeEvent,
  type HealthBody,
  type HistoryBody,
  type HistoryMessage,
  type TurnRequestBody,
} from "./contract.ts";
import { readBridgeEvents } from "./sse.ts";

/**
 * Hermesブリッジのクライアント本体（#737。設定の読み出しは `client.ts`）。
 *
 * 「取得できなかった」と「無い」を混ぜない（#214）。失敗は `HermesError.kind` で次のように区別して画面へ渡す:
 *
 * | kind | 意味 | 画面 |
 * |---|---|---|
 * | `unreachable` | 接続失敗・5秒のタイムアウト・tailscale serveの502/504（ブリッジ停止） | Hermesに届きません（サブPCが止まっている可能性） |
 * | `hermes_down` | ブリッジが503（Hermesへ繋がらない） | Hermesが応答しません |
 * | `rejected` | 401/403 | 接続の設定に問題があります（ログに残す） |
 * | `not_configured` | 宛先URL・トークンが未設定 | 同上 |
 * | `no_session` | 続きのセッションが無い | 会話が見つかりません |
 * | `session_busy` / `bridge_busy` | 同時実行の上限 | 少し待ってから |
 *
 * 「応答はあるが会話が無い（200で空）」は失敗ではない（呼び出し側の通常の空表示）。
 */

export type HermesErrorKind =
  | "unreachable"
  | "hermes_down"
  | "rejected"
  | "not_configured"
  | "no_session"
  | "session_busy"
  | "bridge_busy"
  | "turn_not_found"
  | "bad_request"
  | "bad_response";

export class HermesError extends Error {
  readonly kind: HermesErrorKind;

  constructor(kind: HermesErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = "HermesError";
  }
}

export interface HermesClientConfig {
  /** `HERMES_BRIDGE_URL`。未設定なら null。 */
  baseUrl: string | null;
  /** `MORROW_HERMES_BRIDGE_TOKEN`。未設定なら null。 */
  token: string | null;
  fetchImpl?: typeof fetch;
  connectTimeoutMs?: number;
}

const ERROR_KINDS: ReadonlySet<string> = new Set(["no_session", "session_busy", "bridge_busy", "turn_not_found", "bad_request"]);

/** 応答の状態とブリッジの `{ error }` から、失敗の種類を決める。 */
export function classifyFailure(status: number, reason: string | undefined): HermesError {
  if (status === 401 || status === 403) return new HermesError("rejected", `ブリッジに拒否された（HTTP ${status}）`);
  if (status === 502 || status === 504) return new HermesError("unreachable", `ブリッジに届かない（HTTP ${status}）`);
  if (status === 503) {
    return reason === "hermes_down"
      ? new HermesError("hermes_down", "Hermesが応答しない")
      : new HermesError("unreachable", "ブリッジが一時的に使えない（HTTP 503）");
  }
  if (reason && ERROR_KINDS.has(reason)) return new HermesError(reason as HermesErrorKind, `ブリッジの応答: ${reason}`);
  return new HermesError("bad_response", `ブリッジの応答が不正（HTTP ${status}）`);
}

async function failureOf(response: Response): Promise<HermesError> {
  let reason: string | undefined;
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && typeof (body as { error?: unknown }).error === "string") {
      reason = (body as { error: string }).error;
    }
  } catch {
    // 本文が無い・JSONではない（tailscale serveの502など）
  }
  return classifyFailure(response.status, reason);
}

function isHistoryMessage(value: unknown): value is HistoryMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  if (message.role !== "user" && message.role !== "assistant") return false;
  if (typeof message.text !== "string") return false;
  if (message.at !== null && (typeof message.at !== "number" || !Number.isFinite(message.at))) return false;
  if (message.tools !== undefined && (!Array.isArray(message.tools) || !message.tools.every((tool) => typeof tool === "string"))) {
    return false;
  }
  return true;
}

/**
 * 履歴の応答の形を確かめ、知っている項目だけで組み直す（ブリッジが項目を増やしても画面へ素通しにしない）。
 * 1件でも形が違えば null（応答全体を `bad_response` にする）。
 */
export function parseHistoryBody(body: unknown, sessionId: string): HistoryBody | null {
  if (typeof body !== "object" || body === null) return null;
  const value = body as Record<string, unknown>;
  if (value.sessionId !== sessionId) return null;
  if (value.title !== null && typeof value.title !== "string") return null;
  if (typeof value.hasMore !== "boolean" || !Array.isArray(value.messages)) return null;
  if (!value.messages.every(isHistoryMessage)) return null;
  return {
    sessionId,
    title: value.title,
    hasMore: value.hasMore,
    messages: value.messages.map(({ role, text, at, tools }) => ({ role, text, at, ...(tools ? { tools: [...tools] } : {}) })),
  };
}

export function createHermesClient(config: HermesClientConfig) {
  const doFetch = config.fetchImpl ?? fetch;
  const connectTimeoutMs = config.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;

  /** 接続（ヘッダーが届くまで）に5秒。本文のストリームには掛けない。 */
  async function request(path: string, init: { method: "GET" | "POST"; body?: unknown; signal?: AbortSignal }): Promise<Response> {
    if (!config.baseUrl || !config.token) {
      throw new HermesError("not_configured", "HERMES_BRIDGE_URL または MORROW_HERMES_BRIDGE_TOKEN が未設定");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), connectTimeoutMs);
    const onCallerAbort = () => controller.abort();
    init.signal?.addEventListener("abort", onCallerAbort, { once: true });
    try {
      const response = await doFetch(new URL(path, config.baseUrl), {
        method: init.method,
        headers: {
          authorization: `Bearer ${config.token}`,
          accept: init.method === "POST" && path === "/turns" ? "text/event-stream" : "application/json",
          ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        cache: "no-store",
        signal: controller.signal,
      });
      return response;
    } catch (error) {
      if (init.signal?.aborted) throw error; // 呼び出し側の中止はそのまま
      throw new HermesError("unreachable", error instanceof Error && error.name === "AbortError" ? "ブリッジへの接続がタイムアウトした" : "ブリッジへ接続できない");
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async health(signal?: AbortSignal): Promise<HealthBody> {
      const response = await request("/health", { method: "GET", signal });
      if (!response.ok) throw await failureOf(response);
      const body: unknown = await response.json().catch(() => null);
      if (
        typeof body !== "object" ||
        body === null ||
        (body as HealthBody).bridge !== "ok" ||
        !["ok", "down"].includes((body as HealthBody).hermes)
      ) {
        throw new HermesError("bad_response", "ブリッジの/healthの形が不正");
      }
      return body as HealthBody;
    },

    /**
     * ターンを始め、イベントを順に返す。接続・認証・同時実行の失敗は、最初のイベントを返す前に投げる。
     * `signal` を中止するとブリッジが気付いて実行中のターンを中断する。
     */
    async startTurn(body: TurnRequestBody, signal?: AbortSignal): Promise<AsyncGenerator<BridgeEvent>> {
      const response = await request("/turns", { method: "POST", body, signal });
      if (!response.ok) throw await failureOf(response);
      if (!response.body) throw new HermesError("bad_response", "ブリッジの応答に本文が無い");
      return readBridgeEvents(response.body);
    },

    /**
     * 会話の履歴（#752）。直近 `limit` 件（既定50・上限100）を古い順で返す。**受け取って表示するだけで、保存しない。**
     * 会話が無い・Morrowのセッションではない場合は `no_session`。
     */
    async history(sessionId: string, options: { limit?: number; signal?: AbortSignal } = {}): Promise<HistoryBody> {
      const limit = Math.min(HISTORY_MAX_LIMIT, Math.max(1, Math.trunc(options.limit ?? HISTORY_DEFAULT_LIMIT)));
      const response = await request(`/sessions/${encodeURIComponent(sessionId)}/messages?limit=${limit}`, {
        method: "GET",
        signal: options.signal,
      });
      if (!response.ok) throw await failureOf(response);
      const parsed = parseHistoryBody(await response.json().catch(() => null), sessionId);
      if (!parsed) throw new HermesError("bad_response", "ブリッジの履歴の形が不正");
      return parsed;
    },

    async answerApproval(turnId: string, requestId: string, choice: ApprovalChoice, signal?: AbortSignal): Promise<void> {
      const response = await request(`/turns/${encodeURIComponent(turnId)}/approval`, {
        method: "POST",
        body: { requestId, choice },
        signal,
      });
      if (!response.ok) throw await failureOf(response);
    },

    async interrupt(turnId: string, signal?: AbortSignal): Promise<void> {
      const response = await request(`/turns/${encodeURIComponent(turnId)}/interrupt`, { method: "POST", body: {}, signal });
      if (!response.ok) throw await failureOf(response);
    },
  };
}

export type HermesClient = ReturnType<typeof createHermesClient>;
