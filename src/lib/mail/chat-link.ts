import { isMailMessageId } from "@/lib/mail/contract";

/**
 * チャットの返信に出るメールのリンク（#1218）。返信は受信メールなど外の文章に影響されうるので、
 * アプリ内へ進めるのは `/mail/<メッセージID>` の形だけ（クエリ・追加の階層・`.`・`..` は認めない）。
 * 通れば、本文の画面から会話へ戻れる行き先を返す。通らなければ null。
 */
export function chatMailHref(href: string): string | null {
  const id = /^\/mail\/([^/?#]+)$/.exec(href)?.[1];
  if (!id || !isMailMessageId(id) || /^\.+$/.test(id)) return null;
  return `/mail/${id}?back=/chat`;
}
