import type { HermesErrorKind } from "./client-core.ts";

/**
 * Hermesブリッジの失敗を、画面に出す状態と文言へ読み替える（#794。純粋）。
 * 「届かない」「Hermesが落ちている」「設定の不一致」「会話が無い」「混んでいる」を混ぜない（#214）。
 */

export type ChatConnection = "unknown" | "ok" | "unreachable" | "hermes_down" | "misconfigured";

export type ChatFailure = {
  /** 画面の接続状態。会話の失敗（無い・混んでいる）は接続状態を変えない（null）。 */
  connection: ChatConnection | null;
  status: number;
  message: string;
  /** 画面が使う種類。 */
  kind: HermesErrorKind | "rate_limited" | "invalid";
};

export function describeHermesError(kind: HermesErrorKind): ChatFailure {
  switch (kind) {
    case "unreachable":
      return { connection: "unreachable", status: 502, kind, message: "Hermesに届きません（サブPCが止まっている可能性があります）。" };
    case "hermes_down":
      return { connection: "hermes_down", status: 503, kind, message: "Hermesが応答しません。" };
    case "rejected":
    case "not_configured":
      return { connection: "misconfigured", status: 503, kind, message: "接続の設定に問題があります。" };
    case "no_session":
      return { connection: null, status: 404, kind, message: "続きの会話が見つかりません。新しい会話を始めてください。" };
    case "session_busy":
      return { connection: null, status: 409, kind, message: "まだ前の指示を実行しています。終わってから送ってください。" };
    case "bridge_busy":
      return { connection: null, status: 429, kind, message: "Hermesが混み合っています。少し待ってからもう一度送ってください。" };
    case "turn_not_found":
      return { connection: null, status: 404, kind, message: "実行中の指示が見つかりません（すでに終わった可能性があります）。" };
    case "bad_request":
      return { connection: null, status: 400, kind, message: "指示の形が正しくありません。" };
    default:
      return { connection: "unreachable", status: 502, kind, message: "Hermesの応答を読めませんでした。" };
  }
}

export const RATE_LIMITED: ChatFailure = {
  connection: null,
  status: 429,
  kind: "rate_limited",
  message: "続けて送れません。少し待ってからもう一度送ってください。",
};
