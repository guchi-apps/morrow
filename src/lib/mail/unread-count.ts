import { listMailCached } from "@/lib/mail/aide-client";

/**
 * 未読メールの件数（#877・#1144）。メニューのバッジとアプリアイコンのバッジが同じ値を使う。
 * 受信の未読ビューの1ページ目を数える（`listMailCached()` の60秒キャッシュを通る）。
 * 次のページがある・一部のアカウントが読めなかったときは `more`。取れなかったときはnull。
 */
export async function unreadMailCount(user: { id: string; email: string | null }): Promise<{ count: number; more: boolean } | null> {
  const result = await listMailCached(user, { view: "unread" });
  if (!result.ok) return null;
  const { messages, nextPageToken, partial } = result.value;
  return { count: messages.filter((message) => message.unread).length, more: nextPageToken !== null || partial };
}
