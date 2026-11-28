/**
 * MorrowとHermesブリッジ（`hermes-bridge/`）が共有する契約（#737。設計は `docs/hermes-route.md`）。
 *
 * **Prismaにも `@/` にも触れない純粋なモジュール。** ブリッジ（素のNodeで動く）とMorrowのクライアントの両方が
 * 相対パスで読む。ここを変えるときは両側のテストを見ること。
 */

import type { TurnImage } from "./image-core.ts";

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
  /** 選択肢つきの質問（#1150）。ブリッジは要求を保留し、`POST /turns/<id>/clarify` の回答で答える。 */
  | { type: "clarify"; data: { requestId: string; questions: ClarifyQuestion[] } }
  /** 待っていた質問が答えられないまま閉じた（期限切れ・中断。#1150）。 */
  | { type: "clarify.closed"; data: { requestId: string; reason: string } }
  | { type: "message.complete"; data: { text: string | null; status?: string; usage?: HermesUsage } }
  | { type: "error"; data: { reason: BridgeErrorReason; message?: string } };

export type BridgeEventType = BridgeEvent["type"];

/** 選択肢つきの質問の1問（#1150。Hermesの `clarify` 要求の `questions[]` を写したもの）。 */
export interface ClarifyQuestion {
  /** Hermesの質問id（`q0`・`q1`…）。回答の鍵。 */
  qid: string;
  question: string;
  /** 選択肢。無ければ自由入力。 */
  choices: string[] | null;
  multiSelect: boolean;
}

/** 1つの質問への回答。選択肢のラベル（複数選択は配列）・自由入力の文・スキップ（null）。 */
export type ClarifyAnswer = string | string[] | null;

/** 1回の質問で受け付ける上限（Hermesは1〜5問・選択肢は少数）。 */
export const CLARIFY_MAX_QUESTIONS = 5;
export const CLARIFY_MAX_CHOICES = 12;
export const CLARIFY_MAX_ANSWER_LENGTH = 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Hermesの `clarify` 要求の `questions` を読む。形が読めない質問は落とす。 */
export function parseClarifyQuestions(raw: unknown): ClarifyQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: ClarifyQuestion[] = [];
  for (const item of raw.slice(0, CLARIFY_MAX_QUESTIONS)) {
    if (!isRecord(item)) continue;
    const qid = typeof item.qid === "string" && /^[\w-]{1,32}$/.test(item.qid) ? item.qid : null;
    const question = typeof item.question === "string" ? item.question.trim() : "";
    if (!qid || question === "") continue;
    const choices = Array.isArray(item.choices)
      ? item.choices.filter((c): c is string => typeof c === "string" && c.trim() !== "").slice(0, CLARIFY_MAX_CHOICES)
      : [];
    out.push({
      qid,
      question,
      choices: choices.length > 0 ? choices : null,
      multiSelect: choices.length > 0 && (item.multi_select === true || item.multiSelect === true),
    });
  }
  return out;
}

/**
 * 回答の形を検証し、Hermesへ返す `answers`（`{qid: string | null}`）へ直す。合わなければ null。
 * - 選択肢のある質問は、その選択肢のどれか（複数選択は重複なしの配列で、ラベルのJSON配列の文字列にする）
 * - 選択肢の無い質問は、空でない文（{@link CLARIFY_MAX_ANSWER_LENGTH} 字まで）
 * - null（スキップ）はどの質問でも可。答えの無い質問もスキップとして扱う
 */
export function toHermesClarifyAnswers(
  questions: readonly ClarifyQuestion[],
  answers: unknown,
): Record<string, string | null> | null {
  if (!isRecord(answers)) return null;
  const known = new Map(questions.map((q) => [q.qid, q]));
  if (Object.keys(answers).some((key) => !known.has(key))) return null;
  const out: Record<string, string | null> = {};
  for (const q of questions) {
    const value = answers[q.qid];
    if (value === undefined || value === null) {
      out[q.qid] = null;
      continue;
    }
    if (q.choices) {
      if (q.multiSelect) {
        const picked = Array.isArray(value) ? value : [value];
        if (picked.length === 0) {
          out[q.qid] = null;
          continue;
        }
        if (!picked.every((v) => typeof v === "string" && q.choices!.includes(v))) return null;
        if (new Set(picked).size !== picked.length) return null;
        out[q.qid] = JSON.stringify(picked);
      } else {
        if (typeof value !== "string" || !q.choices.includes(value)) return null;
        out[q.qid] = value;
      }
    } else {
      if (typeof value !== "string") return null;
      const text = value.trim();
      if (text === "" || text.length > CLARIFY_MAX_ANSWER_LENGTH) return null;
      out[q.qid] = text;
    }
  }
  return out;
}

/** ブリッジの失敗の理由。HTTPのエラー本文（`{ error }`）と、SSEの `error` イベントで共通。 */
export type BridgeErrorReason =
  | "unauthorized" // 401: Bearerが違う・未設定
  | "forbidden" // 403: 送信元IPが許可リストに無い
  | "bad_request" // 400
  | "hermes_down" // 503: Hermesへ繋がらない
  | "feature_disabled" // 503: ブリッジでこの機能が設定されていない（スキル・記憶の MORROW_HERMES_HOME 未設定。#1225）
  | "no_session" // 404: 続きのセッションが無い
  | "session_busy" // 409: 同じセッションで別のターンが走っている
  | "bridge_busy" // 429: ブリッジ全体の同時実行の上限
  | "turn_not_found" // 404: 承認・中断の宛先のターンが無い
  | "skill_not_found" // 404: スキルの保留・登録済みスキルが無い（#1154）
  | "skill_rejected" // 409: Hermesが承認を適用しなかった・同梱スキルの削除（#1154）
  | "memory_not_found" // 404: 記憶の保留・保存済みの項目が無い（#1155）
  | "memory_rejected" // 409: Hermesが記憶の承認を適用しなかった（#1155）
  | "timeout" // 1ターン30分の上限
  | "hermes_error"; // Hermesがエラーで終えた

export interface TurnRequestBody {
  sessionId?: string;
  text: string;
  title?: string;
  /** 添付する画像（#1157。検証済み。ブリッジが `image.attach_bytes` で添付してから `prompt.submit` する）。 */
  images?: TurnImage[];
}

/**
 * 会話の履歴の1件（#752。`GET /sessions/<id>/messages`）。表示に要る項目だけで、道具は名前だけ（引数・結果は持たない）。
 * 確認カードの状態はMorrowのDB（`HermesProposal`）が正なので、ここには入れない。
 */
export interface HistoryMessage {
  role: "user" | "assistant";
  text: string;
  /** 発言の時刻（epochミリ秒）。Hermesが持っていなければ null。 */
  at: number | null;
  /** Hermesの発言で呼んだ道具の名前（呼んだ順）。無ければ項目ごと無い。 */
  tools?: string[];
}

export interface HistoryBody {
  sessionId: string;
  title: string | null;
  /** 古い順。直近 `limit` 件まで。 */
  messages: HistoryMessage[];
  /** これより前の発言があるかもしれない（返していない分がある）。 */
  hasMore: boolean;
}

/**
 * 会話の一覧の1件（#1156。`GET /sessions`）。題名・最終更新・件数だけで、本文（発言・先頭の抜粋）は持たない。
 * 持ち主の絞り込みはMorrow側（`HermesSession`）で行う。
 */
export interface SessionSummary {
  sessionId: string;
  title: string | null;
  /** 最後に動いた時刻（epochミリ秒）。分からなければ null。 */
  lastActiveAt: number | null;
  messageCount: number;
}

export interface SessionListBody {
  sessions: SessionSummary[];
}

/** 一覧で一度に引くセッションidの上限。 */
export const SESSION_LIST_MAX_LIMIT = 100;

/** 履歴の既定件数と上限。 */
export const HISTORY_DEFAULT_LIMIT = 50;
export const HISTORY_MAX_LIMIT = 100;

/** ブリッジが受け付けるセッションidの形（`POST /turns` の `sessionId` と同じ）。 */
export const SESSION_ID_PATTERN = /^[\w.:-]{1,128}$/;

/**
 * URLのパスへ埋め込むセッションidか（#752の履歴）。`SESSION_ID_PATTERN` に加え、`.` だけの値を断る。
 * `..` を通すと `new URL()` がパスを畳み、`/api/sessions/../messages` がHermesの別のREST（`/api/messages`）を指す。
 */
export function isPathSafeSessionId(value: string): boolean {
  return SESSION_ID_PATTERN.test(value) && !/^\.+$/.test(value);
}

export interface HealthBody {
  bridge: "ok";
  hermes: "ok" | "down";
  /** HermesがAIDEの道具を読み込めているか（#1158）。判定できない回・古いブリッジでは無い。 */
  aide?: "ok" | "connecting" | "unavailable";
}

/**
 * 1ターン全体の上限（ブリッジ側）。承認・質問の待ち（300秒）を含む。
 * 画面を閉じても続く「あとで調べて報告して」型の依頼のため、#1150で10分から30分へ延ばした。
 */
export const TURN_TIMEOUT_MS = 30 * 60 * 1000;
/** SSEのコメント行を流す間隔。Apacheなどのプロキシに切られないため。 */
export const HEARTBEAT_MS = 15 * 1000;
/** Morrow→ブリッジの接続の上限。 */
export const CONNECT_TIMEOUT_MS = 5 * 1000;
/** ブリッジ全体の同時ターン数（#1150で長いターンが枠を埋めるため2→3）。 */
export const MAX_CONCURRENT_TURNS = 3;
