/**
 * チャットの「前回の会話」の記憶（#929。純粋寄り）。端末のlocalStorageにHermesのセッションidだけを、利用者idと組で持つ。
 * 会話の本文・idをMorrowのサーバーに残さないための置き場所。別の利用者のidは読まない。
 */

import { endTurn, type ChatState } from "./stream-view.ts";

export const SESSION_MEMORY_KEY = "morrow-chat-session";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const SESSION_ID = /^[\w.:-]{1,128}$/;

export function loadSessionId(storage: StorageLike | null, userId: string): string | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(SESSION_MEMORY_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as { userId?: unknown; sessionId?: unknown } | null;
    if (!value || value.userId !== userId || typeof value.sessionId !== "string") return null;
    return SESSION_ID.test(value.sessionId) && !/^\.+$/.test(value.sessionId) ? value.sessionId : null;
  } catch {
    return null;
  }
}

export function saveSessionId(storage: StorageLike | null, userId: string, sessionId: string): void {
  try {
    storage?.setItem(SESSION_MEMORY_KEY, JSON.stringify({ userId, sessionId }));
  } catch {
    // 保存できない環境（プライベートウィンドウなど）では、その場の会話だけで続ける
  }
}

export function clearSessionId(storage: StorageLike | null): void {
  try {
    storage?.removeItem(SESSION_MEMORY_KEY);
  } catch {
    // 消せなくても次の読み出しで利用者idが違えば無視される
  }
}

export function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * 画面遷移で戻ったときの会話のメモリ上の控え（#976）。JSのモジュール変数にだけ持つので、保存はされず、ページの再読み込みで消える。
 * 画面（`ChatView`）は別の画面へ移ると捨てられるため、戻るたびにHermesの履歴を取り直すと、通信の揺れで取れなかった回に会話が消える。
 * 利用者idが違えば読まない。
 */
let chatSnapshot: { userId: string; state: ChatState } | null = null;

/** 実行は画面を離れた時点で中断されている。実行中の印と、答えを待つ承認（もう答えられない）を落として持つ。 */
export function saveChatSnapshot(userId: string, state: ChatState): void {
  if (state.items.length === 0 || !state.sessionId) return;
  const settled = endTurn(state);
  chatSnapshot = {
    userId,
    state: { ...settled, items: settled.items.filter((item) => !(item.kind === "approval" && item.status === "waiting")) },
  };
}

export function loadChatSnapshot(userId: string): ChatState | null {
  return chatSnapshot && chatSnapshot.userId === userId ? chatSnapshot.state : null;
}

export function clearChatSnapshot(): void {
  chatSnapshot = null;
}
