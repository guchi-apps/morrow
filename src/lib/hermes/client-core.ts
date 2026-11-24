import {
  CONNECT_TIMEOUT_MS,
  HISTORY_DEFAULT_LIMIT,
  HISTORY_MAX_LIMIT,
  type ApprovalChoice,
  type ClarifyAnswer,
  type BridgeEvent,
  type HealthBody,
  type HistoryBody,
  type HistoryMessage,
  type SessionListBody,
  type SessionSummary,
  SESSION_LIST_MAX_LIMIT,
  isPathSafeSessionId,
  type TurnRequestBody,
} from "./contract.ts";
import { readBridgeEvents } from "./sse.ts";
import {
  parseMemoryEntriesBody,
  parsePendingMemoriesBody,
  type MemoryEntry,
  type MemoryTarget,
  type PendingMemory,
} from "./memory-core.ts";
import {
  parseInstalledSkillsBody,
  parsePendingSkillsBody,
  PENDING_ID_PATTERN,
  SKILL_NAME_PATTERN,
  type InstalledSkill,
  type PendingSkill,
} from "./skill-core.ts";

/**
 * Hermesブリッジのクライアント本体（#737。設定の読み出しは `client.ts`）。
 *
 * 「取得できなかった」と「無い」を混ぜない（#214）。失敗は `HermesError.kind` で次のように区別して画面へ渡す:
 *
 * | kind | 意味 | 画面 |
 * |---|---|---|
 * | `unreachable` | 接続失敗・5秒のタイムアウト・tailscale serveの502/504（ブリッジ停止） | Hermesに届きません（DeskMiniが止まっている可能性） |
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
  | "skill_not_found"
  | "skill_rejected"
  | "memory_not_found"
  | "memory_rejected"
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

const ERROR_KINDS: ReadonlySet<string> = new Set(["no_session", "session_busy", "bridge_busy", "turn_not_found", "skill_not_found", "skill_rejected", "memory_not_found", "memory_rejected", "bad_request"]);

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

/** 会話の一覧の応答の形を確かめ、知っている項目だけで組み直す（#1156）。1件でも違えば null。 */
export function parseSessionList(body: unknown): SessionListBody | null {
  if (typeof body !== "object" || body === null) return null;
  const list = (body as { sessions?: unknown }).sessions;
  if (!Array.isArray(list)) return null;
  const sessions: SessionSummary[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) return null;
    const row = item as Record<string, unknown>;
    if (typeof row.sessionId !== "string" || !isPathSafeSessionId(row.sessionId)) return null;
    if (row.title !== null && typeof row.title !== "string") return null;
    if (row.lastActiveAt !== null && (typeof row.lastActiveAt !== "number" || !Number.isFinite(row.lastActiveAt))) return null;
    if (typeof row.messageCount !== "number" || !Number.isFinite(row.messageCount)) return null;
    sessions.push({
      sessionId: row.sessionId,
      title: row.title,
      lastActiveAt: row.lastActiveAt,
      messageCount: Math.max(0, Math.trunc(row.messageCount)),
    });
  }
  return { sessions };
}

export function createHermesClient(config: HermesClientConfig) {
  const doFetch = config.fetchImpl ?? fetch;
  const connectTimeoutMs = config.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;

  /** 接続（ヘッダーが届くまで）に5秒。本文のストリームには掛けない。 */
  async function request(path: string, init: { method: "GET" | "POST" | "DELETE"; body?: unknown; signal?: AbortSignal }): Promise<Response> {
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

    /**
     * 会話の一覧（#1156）。渡したid（呼び出し側が `HermesSession` で先に絞った自分のもの。最大100）の題名・最終更新・件数を、
     * 最近動いた順で返す。Morrowのセッションでないid・消えたidは含まれない。
     */
    async listSessions(ids: string[], options: { signal?: AbortSignal } = {}): Promise<SessionSummary[]> {
      const wanted = ids.slice(0, SESSION_LIST_MAX_LIMIT);
      if (wanted.length === 0) return [];
      const response = await request(`/sessions?ids=${wanted.map(encodeURIComponent).join(",")}`, { method: "GET", signal: options.signal });
      if (!response.ok) throw await failureOf(response);
      const parsed = parseSessionList(await response.json().catch(() => null));
      if (!parsed) throw new HermesError("bad_response", "ブリッジの会話一覧の形が不正");
      return parsed.sessions;
    },

    /** 承認待ちのスキル（#1154）。古い順。ブリッジが期限切れ（7日）を消してから返す。 */
    async pendingSkills(signal?: AbortSignal): Promise<PendingSkill[]> {
      const response = await request("/skills/pending", { method: "GET", signal });
      if (!response.ok) throw await failureOf(response);
      const parsed = parsePendingSkillsBody(await response.json().catch(() => null));
      if (!parsed) throw new HermesError("bad_response", "ブリッジのスキル一覧の形が不正");
      return parsed.pending;
    },

    /** 承認（Hermesが保留を実際のスキルとして書く）。`skill_not_found`＝保留が無い、`skill_rejected`＝適用されなかった。 */
    async approveSkill(id: string, signal?: AbortSignal): Promise<void> {
      if (!PENDING_ID_PATTERN.test(id)) throw new HermesError("bad_request", "保留のidの形が正しくない");
      const response = await request(`/skills/pending/${id}/approve`, { method: "POST", body: {}, signal });
      if (!response.ok) throw await failureOf(response);
    },

    async discardSkill(id: string, signal?: AbortSignal): Promise<void> {
      if (!PENDING_ID_PATTERN.test(id)) throw new HermesError("bad_request", "保留のidの形が正しくない");
      const response = await request(`/skills/pending/${id}/discard`, { method: "POST", body: {}, signal });
      if (!response.ok) throw await failureOf(response);
    },

    /** 登録済みのスキル（同梱を含む。`bundled` で見分ける）。 */
    async installedSkills(signal?: AbortSignal): Promise<InstalledSkill[]> {
      const response = await request("/skills/installed", { method: "GET", signal });
      if (!response.ok) throw await failureOf(response);
      const parsed = parseInstalledSkillsBody(await response.json().catch(() => null));
      if (!parsed) throw new HermesError("bad_response", "ブリッジのスキル一覧の形が不正");
      return parsed.skills;
    },

    async deleteSkill(name: string, signal?: AbortSignal): Promise<void> {
      if (!SKILL_NAME_PATTERN.test(name)) throw new HermesError("bad_request", "スキル名の形が正しくない");
      const response = await request(`/skills/installed/${encodeURIComponent(name)}`, { method: "DELETE", signal });
      if (!response.ok) throw await failureOf(response);
    },

    /** 承認待ちの記憶（#1155）。古い順。ブリッジが期限切れ（7日）を消してから返す。 */
    async pendingMemories(signal?: AbortSignal): Promise<PendingMemory[]> {
      const response = await request("/memory/pending", { method: "GET", signal });
      if (!response.ok) throw await failureOf(response);
      const parsed = parsePendingMemoriesBody(await response.json().catch(() => null));
      if (!parsed) throw new HermesError("bad_response", "ブリッジの記憶の保留の形が不正");
      return parsed.pending;
    },

    /** 承認（Hermesが保留を実際の記憶へ書く）。`memory_not_found`＝保留が無い、`memory_rejected`＝適用されなかった。 */
    async approveMemory(id: string, signal?: AbortSignal): Promise<void> {
      if (!PENDING_ID_PATTERN.test(id)) throw new HermesError("bad_request", "保留のidの形が正しくない");
      const response = await request(`/memory/pending/${id}/approve`, { method: "POST", body: {}, signal });
      if (!response.ok) throw await failureOf(response);
    },

    async discardMemory(id: string, signal?: AbortSignal): Promise<void> {
      if (!PENDING_ID_PATTERN.test(id)) throw new HermesError("bad_request", "保留のidの形が正しくない");
      const response = await request(`/memory/pending/${id}/discard`, { method: "POST", body: {}, signal });
      if (!response.ok) throw await failureOf(response);
    },

    /** 保存済みの記憶（あなたについての記憶・Hermesのメモ）。 */
    async memoryEntries(signal?: AbortSignal): Promise<MemoryEntry[]> {
      const response = await request("/memory/entries", { method: "GET", signal });
      if (!response.ok) throw await failureOf(response);
      const parsed = parseMemoryEntriesBody(await response.json().catch(() => null));
      if (!parsed) throw new HermesError("bad_response", "ブリッジの記憶一覧の形が不正");
      return parsed.entries;
    },

    /** 1項目の削除。全文が一致した項目だけ消える（`memory_not_found`＝すでに変わった）。 */
    async deleteMemoryEntry(target: MemoryTarget, text: string, signal?: AbortSignal): Promise<void> {
      if (text.trim() === "") throw new HermesError("bad_request", "記憶の本文が空");
      const response = await request("/memory/entries", { method: "DELETE", body: { target, text }, signal });
      if (!response.ok) throw await failureOf(response);
    },

    async answerApproval(turnId: string, requestId: string, choice: ApprovalChoice, signal?: AbortSignal): Promise<void> {
      const response = await request(`/turns/${encodeURIComponent(turnId)}/approval`, {
        method: "POST",
        body: { requestId, choice },
        signal,
      });
      if (!response.ok) throw await failureOf(response);
    },

    /** 選択肢つきの質問への回答（#1150）。`answers` は `{qid: 選択肢 | 選択肢[] | 文 | null}`。形の検証はブリッジでも行う。 */
    async answerClarify(turnId: string, requestId: string, answers: Record<string, ClarifyAnswer>, signal?: AbortSignal): Promise<void> {
      const response = await request(`/turns/${encodeURIComponent(turnId)}/clarify`, {
        method: "POST",
        body: { requestId, answers },
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
