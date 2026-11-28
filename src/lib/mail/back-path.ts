import { isInternalPath } from "@/lib/safe-path";

/**
 * 本文から戻る先。一覧（`/mail…`）と、チャットのリンクから開いた回の `/chat`（#1218）だけを受け付ける。外から与えられる値なので `isInternalPath()` も通す。
 * 本文の画面と読み込み中のスケルトン（クライアント）の両方が使うので、サーバー専用のものを持ち込まない。
 */
export function safeMailBack(value: string | null | undefined): string {
  if (value === "/chat") return value;
  return value && value.startsWith("/mail") && isInternalPath(value) ? value : "/mail";
}
