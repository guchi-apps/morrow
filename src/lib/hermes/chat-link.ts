/**
 * チャット画面（`ChatView`）とメニューの会話の履歴（#1228）をつなぐ小さなストア（純粋）。
 *
 * 一覧はレイアウト側のメニュー、会話の状態はページ側の画面にあり、propsでは届かない。画面が開いている間だけ
 * 「開いている会話・実行中・切り替え方」を置く。`open` が null なら画面は開いておらず、メニューは `/chat?session=` へ移動する。
 */

export interface ChatLinkState {
  currentId: string | null;
  /** 実行中は切り替えない。 */
  busy: boolean;
  /** 変わると一覧を取り直す（会話が変わった・実行が終わった）。 */
  refreshKey: string;
  open: ((sessionId: string) => void) | null;
}

export const EMPTY_CHAT_LINK: ChatLinkState = { currentId: null, busy: false, refreshKey: "", open: null };

let state = EMPTY_CHAT_LINK;
const listeners = new Set<() => void>();

export function chatLink(): ChatLinkState {
  return state;
}

export function publishChatLink(next: ChatLinkState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function resetChatLink(): void {
  publishChatLink(EMPTY_CHAT_LINK);
}

export function subscribeChatLink(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
