import {
  APPROVAL_CHOICES,
  parseClarifyQuestions,
  toHermesClarifyAnswers,
  isApprovalChoice,
  type ApprovalChoice,
  type BridgeEvent,
  type ClarifyQuestion,
  type HermesUsage,
  type TurnRequestBody,
} from "../src/lib/hermes/contract.ts";
import { checkImageBase64, imageFilename, type TurnImage } from "../src/lib/hermes/image-core.ts";
import { HermesRpcError, type HermesLink } from "./hermes-link.ts";

/**
 * 1ターンの進行（#737）。Hermesのイベントのうち、チャットに要るものだけを `BridgeEvent` に写して流す。
 * 通さないもの（`tools.configure`・設定・削除・dashboard系）は、そもそもこのモジュールが呼ぶメソッドに無い。
 */

/** セッションの `source`。Hermes側の一覧で見分けるため固定する。 */
export const SESSION_SOURCE = "morrow";

/** 続きのセッションが無い（`session.resume` が断られた）。 */
export class NoSessionError extends Error {}

export interface OpenedSession {
  /** Hermesのいまの接続でのセッションid（`prompt.submit` などに使う）。 */
  liveId: string;
  /** 次の指示で `session.resume` に渡す、保存されたセッションid。 */
  storedId: string;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * 接続の初期化（承認を受けるための宣言）と、セッションの作成または再開。
 * **`client.capabilities {server_requests:true}` を送らないと承認が聞かれずに取り下げられる**（#725）。
 */
export async function openSession(link: HermesLink, body: TurnRequestBody): Promise<OpenedSession> {
  await link.rpc("client.capabilities", { server_requests: true });

  if (body.sessionId) {
    let result: Record<string, unknown>;
    try {
      result = await link.rpc("session.resume", { session_id: body.sessionId, omit_messages: true, source: SESSION_SOURCE });
    } catch (error) {
      if (error instanceof HermesRpcError) throw new NoSessionError(error.message);
      throw error;
    }
    const liveId = str(result.session_id) ?? body.sessionId;
    return { liveId, storedId: str(result.stored_session_id) ?? body.sessionId };
  }

  const result = await link.rpc("session.create", {
    source: SESSION_SOURCE,
    ...(body.title ? { title: body.title } : {}),
  });
  const liveId = str(result.session_id);
  if (!liveId) throw new Error("session.create の応答にsession_idが無い");
  return { liveId, storedId: str(result.stored_session_id) ?? liveId };
}

/** Hermesの `choices` から、通してよい回答（`once`・`deny`）だけを残す。`deny` は必ず含める。 */
export function allowedChoices(choices: unknown): ApprovalChoice[] {
  const given = Array.isArray(choices) ? choices : [];
  const kept = APPROVAL_CHOICES.filter((choice) => given.includes(choice));
  return kept.includes("deny") ? kept : [...kept, "deny"];
}

export interface TurnHandle {
  /** 承認待ちの `requestId` に答える。待っていない `requestId` なら false。 */
  respondApproval(requestId: string, choice: ApprovalChoice): Promise<boolean>;
  /**
   * 選択肢つきの質問（#1150）に答える。待っていない `requestId` なら "not_found"、回答の形が合わなければ "invalid"。
   * Hermesへはサーバー要求への応答 `{answers, outcome: "submitted"}` で返す（`clarify.lock` は使わない）。
   */
  respondClarify(requestId: string, answers: unknown): "ok" | "not_found" | "invalid";
  /** 実行中のターンを中断する（切断・上限超過・利用者の中断）。 */
  interrupt(): Promise<void>;
  /** ターンが終わったら解決する（正常・エラー・中断のどれでも）。 */
  done: Promise<void>;
}

/** 画像を `prompt.submit` の前に1枚ずつ添付する。種類は署名で決め直し、申告のファイル名は使わない（#1157）。 */
export async function attachImages(link: HermesLink, sessionId: string, images: readonly TurnImage[]): Promise<void> {
  for (const [index, image] of images.entries()) {
    const checked = checkImageBase64(image.data);
    if (!checked.ok) throw new Error(checked.reason);
    await link.rpc("image.attach_bytes", {
      session_id: sessionId,
      content_base64: image.data,
      filename: imageFilename(index, checked.type),
    });
  }
}

export function runTurn(options: {
  link: HermesLink;
  session: OpenedSession;
  text: string;
  /** 添付する画像（#1157）。`prompt.submit` の前に1枚ずつ `image.attach_bytes` で添付する。 */
  images?: TurnImage[];
  emit: (event: BridgeEvent) => void;
  timeoutMs: number;
}): TurnHandle {
  const { link, session, text, emit, timeoutMs } = options;
  const images = options.images ?? [];
  const pendingApprovals = new Set<string>();
  /** 答えを待っている質問（要求のid → 質問）。 */
  const pendingClarify = new Map<string, ClarifyQuestion[]>();
  let finished = false;
  let finish: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });

  const end = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    finish();
  };

  const interrupt = async () => {
    try {
      await link.rpc("session.interrupt", { session_id: session.liveId });
    } catch {
      // 既に終わっている・接続が切れている
    }
  };

  const timer = setTimeout(() => {
    if (finished) return;
    void interrupt();
    emit({ type: "error", data: { reason: "timeout", message: "1ターンの上限時間を超えたため中断しました" } });
    end();
  }, timeoutMs);

  link.onEvent((event) => {
    if (finished || (event.sessionId && event.sessionId !== session.liveId)) return;
    const payload = event.payload;
    switch (event.type) {
      case "message.delta":
        emit({ type: "message.delta", data: { text: str(payload.text) ?? "" } });
        break;
      case "reasoning.delta":
      case "thinking.delta":
        emit({ type: "reasoning.delta", data: { text: str(payload.text) ?? "" } });
        break;
      case "tool.start":
        emit({
          type: "tool.start",
          data: { name: str(payload.name) ?? "", args: payload.args, ...(str(payload.context) ? { context: str(payload.context) } : {}) },
        });
        break;
      case "tool.progress":
        emit({ type: "tool.progress", data: payload });
        break;
      case "tool.complete":
        emit({
          type: "tool.complete",
          data: {
            name: str(payload.name),
            result: payload.result,
            durationSeconds: typeof payload.duration_s === "number" ? payload.duration_s : undefined,
          },
        });
        break;
      case "message.complete":
        emit({
          type: "message.complete",
          data: {
            text: typeof payload.text === "string" ? payload.text : null,
            status: str(payload.status),
            usage: typeof payload.usage === "object" && payload.usage !== null ? (payload.usage as HermesUsage) : undefined,
          },
        });
        end();
        break;
      case "error":
        emit({ type: "error", data: { reason: "hermes_error", message: str(payload.message) } });
        end();
        break;
      case "request.cancel": {
        // 待っていた質問が期限切れ（既定300秒）・中断で閉じた。画面のカードを閉じさせる
        const requestId = str(payload.id);
        if (requestId && pendingClarify.delete(requestId)) {
          emit({ type: "clarify.closed", data: { requestId, reason: str(payload.reason) ?? "cancelled" } });
        }
        break;
      }
      default:
        // 通さないイベント（スキン・ステータス・変更通知など）
        break;
    }
  });

  link.onServerRequest((request) => {
    if (finished) return;
    if (request.method === "approval") {
      const requestId = str(request.params.request_id) ?? request.id;
      pendingApprovals.add(requestId);
      emit({
        type: "approval",
        data: {
          requestId,
          command: str(request.params.command),
          description: str(request.params.description),
          choices: allowedChoices(request.params.choices),
        },
      });
      return;
    }
    if (request.method === "clarify") {
      // 要求を保留し、画面の回答（`POST /turns/<id>/clarify`）で応答する（#1150）。読める質問が無ければ辞退
      const questions = parseClarifyQuestions(request.params.questions);
      if (questions.length > 0) {
        pendingClarify.set(request.id, questions);
        emit({ type: "clarify", data: { requestId: request.id, questions } });
        return;
      }
    }
    // 知らない要求（sudo・secretなど）は「処理できない」で返す。承認を勝手に通さない
    link.reply(request.id, { error: { code: -32601, message: "このクライアントは対応していません" } });
  });

  link.onClose(() => {
    if (finished) return;
    emit({ type: "error", data: { reason: "hermes_down", message: "Hermesとの接続が切れました" } });
    end();
  });

  attachImages(link, session.liveId, images)
    .then(() => (finished ? undefined : link.rpc("prompt.submit", { session_id: session.liveId, text })))
    .catch((error: unknown) => {
      if (finished) return;
      emit({ type: "error", data: { reason: "hermes_error", message: error instanceof Error ? error.message : "prompt.submit に失敗した" } });
      end();
    });

  return {
    async respondApproval(requestId, choice) {
      if (!isApprovalChoice(choice) || !pendingApprovals.has(requestId)) return false;
      pendingApprovals.delete(requestId);
      await link.rpc("approval.respond", { session_id: session.liveId, request_id: requestId, choice, all: false });
      return true;
    },
    respondClarify(requestId, answers) {
      const questions = pendingClarify.get(requestId);
      if (!questions || finished) return "not_found";
      const converted = toHermesClarifyAnswers(questions, answers);
      if (!converted) return "invalid";
      pendingClarify.delete(requestId);
      link.reply(requestId, { result: { answers: converted, outcome: "submitted" } });
      return "ok";
    },
    interrupt,
    done,
  };
}
