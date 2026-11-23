import { unreadMailCount } from "@/lib/mail/unread-count";

import { MenuBadge } from "./menu-badge";

/**
 * メニューの「メール」の未読件数バッジ（#877）。件数は `unreadMailCount()`（アプリアイコンのバッジ #1144 と共通）。
 * 次のページがある・一部のアカウントが読めなかったときは「N+」。取れなかったとき・未設定のときは何も出さない（エラー表示にはしない）。
 */
export async function MailUnreadBadge({ user }: { user: { id: string; email: string | null } }) {
  const unread = await unreadMailCount(user);
  if (!unread) return null;
  const { count, more } = unread;
  return <MenuBadge count={count} more={more} label={`未読メール${count}${more ? "件以上" : "件"}`} />;
}
