import { listMailCached } from "@/lib/mail/aide-client";

import { MenuBadge } from "./menu-badge";

/**
 * メニューの「メール」の未読件数バッジ（#877）。受信の未読ビューの1ページ目を数える
 * （画面と同じ60秒のキャッシュ `listMailCached()` を通るので、描画のたびにAIDEへは行かない）。
 * 次のページがあれば「N+」。取れなかったとき・未設定のときは何も出さない（エラー表示にはしない）。
 */
export async function MailUnreadBadge({ user }: { user: { id: string; email: string | null } }) {
  const result = await listMailCached(user, { view: "unread" });
  if (!result.ok) return null;

  const { messages, nextPageToken } = result.value;
  const count = messages.filter((message) => message.unread).length;
  return <MenuBadge count={count} more={nextPageToken !== null} label={`未読メール${count}${nextPageToken !== null ? "件以上" : "件"}`} />;
}
