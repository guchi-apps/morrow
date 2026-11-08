/**
 * MorrowとHermesブリッジ（`hermes-bridge/`）が共有する契約（#737。設計は `docs/hermes-route.md`）。
 *
 * **Prismaにも `@/` にも触れない純粋なモジュール。** ブリッジ（素のNodeで動く）とMorrowのクライアントの両方が
 * 相対パスで読む。ここを変えるときは両側のテストを見ること。
 */

/** ブリッジが承認の回答として受け付ける値。`always`・`session` は通さない（`docs/hermes-actions.md`）。 */
export const APPROVAL_CHOICES = ["once", "deny"] as const;
export type ApprovalChoice = (typeof APPROVAL_CHOICES)[number];

export function isApprovalChoice(value: unknown): value is ApprovalChoice {
  return typeof value === "string" && (APPROVAL_CHOICES as readonly string[]).includes(value);
}

/** Hermesの `message.complete.usage`。キャッシュ以外の入力が `input`（#725の実測）。 */
export interface HermesUsage {
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
  prompt?: number;
  model?: string;
}

/** ブリッジがSSEで流すイベント。Hermesのイベントのうち、チャットに要るものだけを種類別に通す。 */
export type BridgeEvent =
  /** 最初に1回。以後の承認・中断の宛先（`turnId`）と、次の指示の続き先（`sessionId`）。 */
  | { type: "turn"; data: { turnId: string; sessionId: string } }
  | { type: "message.delta"; data: { text: string } }
  | { type: "reasoning.delta"; data: { text: string } }
  | { type: "tool.start"; data: { name: string; args: unknown; context?: string } }
  | { type: "tool.progress"; data: Record<string, unknown> }
  | { type: "tool.complete"; data: { name?: string; result?: unknown; durationSeconds?: number } }
  | {
      type: "approval";
      data: { requestId: string; command?: string; description?: string; choices: ApprovalChoice[] };
    }
  /** 選択肢つきの質問。ブリッジは答えず（辞退で返す）、利用者には質問として見せる。 */
  | { type: "clarify"; data: { questions: unknown } }
  | { type: "message.complete"; data: { text: string | null; status?: string; usage?: HermesUsage } }
  | { type: "error"; data: { reason: BridgeErrorReason; message?: string } };

export type BridgeEventType = BridgeEvent["type"];

/** ブリッジの失敗の理由。HTTPのエラー本文（`{ error }`）と、SSEの `error` イベントで共通。 */
export type BridgeErrorReason =
  | "unauthorized" // 401: Bearerが違う・未設定
  | "forbidden" // 403: 送信元IPが許可リストに無い
  | "bad_request" // 400
  | "hermes_down" // 503: Hermesへ繋がらない
  | "no_session" // 404: 続きのセッションが無い
  | "session_busy" // 409: 同じセッションで別のターンが走っている
  | "bridge_busy" // 429: ブリッジ全体の同時実行の上限
  | "turn_not_found" // 404: 承認・中断の宛先のターンが無い
  | "timeout" // 1ターン10分の上限
  | "hermes_error"; // Hermesがエラーで終えた

export interface TurnRequestBody {
  sessionId?: string;
  text: string;
  title?: string;
}

export interface HealthBody {
  bridge: "ok";
  hermes: "ok" | "down";
}

/** 1ターン全体の上限（ブリッジ側）。承認待ちの上限（300秒）を含む。 */
export const TURN_TIMEOUT_MS = 10 * 60 * 1000;
/** SSEのコメント行を流す間隔。Apacheなどのプロキシに切られないため。 */
export const HEARTBEAT_MS = 15 * 1000;
/** Morrow→ブリッジの接続の上限。 */
export const CONNECT_TIMEOUT_MS = 5 * 1000;
/** ブリッジ全体の同時ターン数。 */
export const MAX_CONCURRENT_TURNS = 2;
