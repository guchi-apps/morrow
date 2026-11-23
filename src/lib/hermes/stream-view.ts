import type { BridgeEvent, BridgeEventType, HermesUsage } from "./contract.ts";
import { stripAttachments } from "./prompt-attachment.ts";
import type { ProposalView } from "./proposal-core.ts";
import { argLines, isAutoWriteTool, knownToolKey, resultFailed, resultSummary, toolHint, toolLabel, type ArgLine, type ResultSummary } from "./tool-labels.ts";

/**
 * チャット画面の状態（#794。純粋）。ブリッジのイベント（MorrowのRoute Handlerが中継する）を、画面の並びへ畳み込む。
 * 会話の本文はこの画面のstateにだけ持つ（Morrowのサーバーにも残さない。リロードで消える。過去の表示は #752）。
 */

/** Morrowが中継で足すイベント。ブリッジの `propose` 道具の呼び出しを、保存した確認カードへ置き換えたもの。 */
export type RelayEvent =
  | BridgeEvent
  | { type: "proposal"; data: { proposal: ProposalView } }
  /** Morrowが発言へ添えたもの（受信メールの参照など。#813）を知らせる1行。 */
  | { type: "notice"; data: { text: string } };

export const RELAY_EVENT_TYPES: ReadonlySet<string> = new Set<BridgeEventType | "proposal" | "notice">([
  "turn",
  "message.delta",
  "tool.start",
  "tool.complete",
  "approval",
  "clarify",
  "message.complete",
  "error",
  "proposal",
  "notice",
]);

export type ChatItem =
  | { kind: "user"; id: number; text: string }
  | { kind: "assistant"; id: number; text: string; done: boolean }
  | {
      kind: "tool";
      id: number;
      name: string;
      label: string;
      /** チップに添える短い手掛かり（検索語・読み込み先のドメイン・知らない道具の名前）。無ければ null。#814 */
      hint: string | null;
      /** unknown: tool.completeを受けないままターンが終わった（中断・切断）。結果は分からない。 */
      status: "running" | "done" | "failed" | "unknown";
      /** 取り消せる書き込み（自動実行）。結果カードで出す。 */
      auto: boolean;
      lines: ArgLine[];
      /** 結果の要約（作成物のリンク・失敗の理由）。結果が届いていない・何も取れないときは null。 */
      result: ResultSummary | null;
      /** 道具を始めた時刻（epochミリ秒。経過秒の表示用。#1158）。復元した控えなど無いときは null。 */
      startedAt?: number | null;
      /** 終わるまでにかかった秒（Hermesの `duration_s`）。届かなければ null。 */
      durationSeconds?: number | null;
    }
  | { kind: "proposal"; id: number; proposal: ProposalView }
  | {
      kind: "approval";
      id: number;
      requestId: string;
      command: string | null;
      description: string | null;
      status: "waiting" | "once" | "deny";
    }
  | { kind: "clarify"; id: number; text: string }
  | {
      kind: "notice";
      id: number;
      tone: "info" | "error";
      text: string;
      /** 失敗したターンの再送（#1158）。`risky` は書き込みが走った可能性がある回で、自動では再送しない。 */
      retry?: { text: string; risky: boolean };
    }
  /** 1ターンのトークン量（#1158。金額は出さない）。 */
  | { kind: "usage"; id: number; text: string };

export type ChatState = {
  items: ChatItem[];
  sessionId: string | null;
  /** 実行中のターン。承認・中断の宛先。 */
  turnId: string | null;
  running: boolean;
  nextId: number;
  /** 最後にイベントが届いた時刻（「考え中 N秒」の起点。#1158）。 */
  activityAt?: number | null;
};

export const initialChatState: ChatState = { items: [], sessionId: null, turnId: null, running: false, nextId: 1, activityAt: null };

/** 前回の会話の履歴（#929）を並びへ戻す。発言の文だけで、道具のチップ・結果カードは復元しない。 */
export function restoreFromHistory(
  state: ChatState,
  sessionId: string,
  messages: ReadonlyArray<{ role: "user" | "assistant"; text: string }>,
): ChatState {
  let nextId = state.nextId;
  const items: ChatItem[] = [];
  for (const m of messages) {
    // 利用者の発言は、Morrowが先頭へ足した注記・メール本文を落とした入力部分だけ出す
    const text = m.role === "user" ? stripAttachments(m.text) : m.text;
    if (text.trim() === "") continue;
    items.push(m.role === "user" ? { kind: "user", id: nextId++, text } : { kind: "assistant", id: nextId++, text, done: true });
  }
  if (items.length === 0) return { ...state, sessionId };
  return { ...state, sessionId, items: [...items, ...state.items], nextId };
}

function push(state: ChatState, item: (id: number) => ChatItem): ChatState {
  return { ...state, items: [...state.items, item(state.nextId)], nextId: state.nextId + 1 };
}

function replaceAt(state: ChatState, index: number, item: ChatItem): ChatState {
  const items = state.items.slice();
  items[index] = item;
  return { ...state, items };
}

/** 利用者の指示を送った（接続できたあと）。 */
export function startTurn(state: ChatState, text: string, now: number = Date.now()): ChatState {
  return { ...push(state, (id) => ({ kind: "user", id, text })), running: true, turnId: null, activityAt: now };
}

/** 生成中の吹き出しを閉じる（道具・承認など別の要素が挟まるとき）。 */
function closeAssistant(state: ChatState): ChatState {
  const last = state.items.length - 1;
  const item = state.items[last];
  if (item?.kind === "assistant" && !item.done) return replaceAt(state, last, { ...item, done: true });
  return state;
}

/** ターンが終わった（正常・中断・切断）。実行中の道具・承認待ちを閉じる。 */
export function endTurn(state: ChatState): ChatState {
  const items = state.items.map((item): ChatItem => {
    if (item.kind === "assistant" && !item.done) return { ...item, done: true };
    // 終わったのに「実行中」のまま残さない。結果は分からないので、成功（done）にも失敗にもせず unknown にする
    if (item.kind === "tool" && item.status === "running") return { ...item, status: "unknown" };
    return item;
  });
  return { ...state, items, running: false, turnId: null, activityAt: null };
}

export function addNotice(state: ChatState, tone: "info" | "error", text: string): ChatState {
  return push(state, (id) => ({ kind: "notice", id, tone, text }));
}

export function answerApproval(state: ChatState, requestId: string, choice: "once" | "deny"): ChatState {
  const index = state.items.findIndex((item) => item.kind === "approval" && item.requestId === requestId);
  const item = state.items[index];
  if (item?.kind !== "approval") return state;
  return replaceAt(state, index, { ...item, status: choice });
}

export function updateProposal(state: ChatState, proposal: ProposalView): ChatState {
  const index = state.items.findIndex((item) => item.kind === "proposal" && item.proposal.id === proposal.id);
  const item = state.items[index];
  if (item?.kind !== "proposal") return state;
  return replaceAt(state, index, { ...item, proposal });
}

function findRunningTool(state: ChatState, name: string | undefined): number {
  const key = knownToolKey(name);
  for (let i = state.items.length - 1; i >= 0; i -= 1) {
    const item = state.items[i];
    if (item.kind !== "tool" || item.status !== "running") continue;
    if (!name || knownToolKey(item.name) === key) return i;
  }
  return -1;
}

/** `Array.prototype.reduce` に渡しても第3引数（index）を時刻と取り違えないよう、時刻を取る版と分ける。 */
export function applyEvent(state: ChatState, event: RelayEvent): ChatState {
  return applyEventAt(state, event, Date.now());
}

/** 失敗したターンの再送の材料。書き込みが走った・走ったか分からない回は `risky`。 */
export function retryOf(state: ChatState): { text: string; risky: boolean } | null {
  const index = lastUserIndex(state);
  const user = state.items[index];
  if (user?.kind !== "user") return null;
  const after = state.items.slice(index + 1);
  const risky = after.some(
    (item) =>
      (item.kind === "tool" && item.auto && item.status !== "failed") ||
      item.kind === "proposal" ||
      (item.kind === "approval" && item.status === "once"),
  );
  return { text: user.text, risky };
}

/** 1ターンのトークン量の1行（入力はキャッシュ込みの総量）。取れなければ null。 */
export function usageText(usage: HermesUsage | undefined): string | null {
  if (!usage) return null;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
  const input = Math.max(n(usage.prompt), n(usage.input) + n(usage.cache_read) + n(usage.cache_write));
  const output = n(usage.output);
  if (input + output <= 0) return null;
  return `今回の使用量: 入力 ${input.toLocaleString("ja-JP")}・出力 ${output.toLocaleString("ja-JP")} トークン`;
}

export function applyEventAt(state: ChatState, event: RelayEvent, now: number): ChatState {
  return applyEventInner({ ...state, activityAt: now }, event, now);
}

function applyEventInner(state: ChatState, event: RelayEvent, now: number): ChatState {
  switch (event.type) {
    case "turn":
      return { ...state, turnId: event.data.turnId, sessionId: event.data.sessionId };

    case "message.delta": {
      const text = event.data.text;
      if (text === "") return state;
      const last = state.items.length - 1;
      const item = state.items[last];
      if (item?.kind === "assistant" && !item.done) return replaceAt(state, last, { ...item, text: item.text + text });
      return push(state, (id) => ({ kind: "assistant", id, text, done: false }));
    }

    case "tool.start": {
      const name = event.data.name;
      const auto = isAutoWriteTool(name);
      const closed = closeAssistant(state);
      return push(closed, (id) => ({
        kind: "tool",
        id,
        name,
        label: toolLabel(name, event.data.args),
        hint: toolHint(name, event.data.args),
        status: "running",
        auto,
        lines: auto ? argLines(event.data.args) : [],
        result: null,
        startedAt: now,
        durationSeconds: null,
      }));
    }

    case "tool.complete": {
      const index = findRunningTool(state, event.data.name);
      const item = state.items[index];
      if (item?.kind !== "tool") return state;
      return replaceAt(state, index, {
        ...item,
        status: resultFailed(event.data.result) ? "failed" : "done",
        result: item.auto ? resultSummary(event.data.result) : null,
        durationSeconds:
          typeof event.data.durationSeconds === "number" && Number.isFinite(event.data.durationSeconds)
            ? event.data.durationSeconds
            : item.startedAt
              ? Math.max(0, (now - item.startedAt) / 1000)
              : null,
      });
    }

    case "proposal": {
      if (state.items.some((item) => item.kind === "proposal" && item.proposal.id === event.data.proposal.id)) return state;
      return push(closeAssistant(state), (id) => ({ kind: "proposal", id, proposal: event.data.proposal }));
    }

    case "notice":
      return addNotice(closeAssistant(state), "info", event.data.text);

    case "approval":
      return push(closeAssistant(state), (id) => ({
        kind: "approval",
        id,
        requestId: event.data.requestId,
        command: event.data.command ?? null,
        description: event.data.description ?? null,
        status: "waiting",
      }));

    case "clarify":
      return push(closeAssistant(state), (id) => ({ kind: "clarify", id, text: clarifyText(event.data.questions) }));

    case "message.complete": {
      let next = state;
      const finalText = event.data.text;
      if (typeof finalText === "string" && finalText !== "") {
        const last = next.items.length - 1;
        const item = next.items[last];
        if (item?.kind === "assistant" && !item.done) {
          // 生成中の吹き出しは、確定した全文で置き換える
          next = replaceAt(next, last, { ...item, text: finalText, done: true });
        } else if (!next.items.slice(lastUserIndex(next) + 1).some((i) => i.kind === "assistant")) {
          // 途中の本文が1つも届かなかった回（まとめて届いた）だけ、全文を1つの吹き出しにする
          next = push(next, (id) => ({ kind: "assistant", id, text: finalText, done: true }));
        }
      }
      if (event.data.status === "interrupted") next = addNotice(next, "info", "止めました。");
      const usage = usageText(event.data.usage);
      if (usage) next = push(next, (id) => ({ kind: "usage", id, text: usage }));
      return endTurn(next);
    }

    case "error": {
      const retry = retryOf(state);
      const noticed = push(state, (id) => ({
        kind: "notice",
        id,
        tone: "error",
        text: event.data.message || "Hermesの実行中にエラーが起きました。",
        ...(retry ? { retry } : {}),
      }));
      return endTurn(noticed);
    }

    default:
      return state;
  }
}

function lastUserIndex(state: ChatState): number {
  for (let i = state.items.length - 1; i >= 0; i -= 1) if (state.items[i].kind === "user") return i;
  return -1;
}

/** 選択肢つきの質問は承認ではないので、ふつうの質問文として出す。形が読めなければ定型文。 */
export function clarifyText(questions: unknown): string {
  const texts: string[] = [];
  const visit = (value: unknown) => {
    if (typeof value === "string") texts.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (typeof value === "object" && value !== null) {
      const record = value as Record<string, unknown>;
      for (const key of ["question", "text", "prompt"]) if (typeof record[key] === "string") return void texts.push(record[key] as string);
    }
  };
  visit(questions);
  return texts.length > 0 ? texts.join("\n") : "Hermesが確認したいことがあるようです。続きを送って答えてください。";
}
