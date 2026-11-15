import { useSyncExternalStore } from "react";

/** ヘッダー右上の操作アイコンの置き場のid（`chat-shell.tsx` が置き、各画面がポータルで中身を入れる。#883）。 */
export const HEADER_ACTIONS_ID = "header-actions";

const subscribeNothing = () => () => {};
const findSlot = () => document.getElementById(HEADER_ACTIONS_ID);

/** 置き場の要素。マウント後に見つかる（サーバー描画・置き場が無い画面では null）。 */
export function useHeaderSlot(): HTMLElement | null {
  return useSyncExternalStore(subscribeNothing, findSlot, () => null);
}

/** ヘッダー右上のアイコンボタンの見た目（正方形34px）。 */
export const HEADER_ICON_BUTTON =
  "relative grid size-[34px] place-items-center rounded-[10px] border border-border bg-background transition-colors hover:bg-rail-active disabled:opacity-50";
