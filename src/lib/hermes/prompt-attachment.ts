/**
 * Hermesへ送る発言の先頭に、Morrowが足す注記（提案の伝達・参照メール。#813）を固定の区切りで囲む（#929。純粋）。
 * 履歴の復元で利用者の吹き出しに注記・メール本文が出ないよう、画面側がこの区切りのブロックを落とす。
 */

export const ATTACHMENT_OPEN = "<!--morrow-context-->";
export const ATTACHMENT_CLOSE = "<!--/morrow-context-->";

/** 注記（空は除く）を区切りで囲み、利用者の指示を後ろに置く。注記が無ければ指示そのまま。 */
export function buildPrompt(attachments: ReadonlyArray<string | null | undefined>, text: string): string {
  const parts = attachments.filter((part): part is string => typeof part === "string" && part !== "");
  if (parts.length === 0) return text;
  // 注記の中に区切りが混ざっても、囲みを壊さない
  const body = parts.join("\n\n").split(ATTACHMENT_OPEN).join("").split(ATTACHMENT_CLOSE).join("");
  return `${ATTACHMENT_OPEN}\n${body}\n${ATTACHMENT_CLOSE}\n\n${text}`;
}

/** 区切りのブロックを落として、利用者の入力部分だけを返す。閉じていない区切りは、そこから後ろを落とす。 */
export function stripAttachments(text: string): string {
  let out = text;
  for (;;) {
    const open = out.indexOf(ATTACHMENT_OPEN);
    if (open === -1) break;
    const close = out.indexOf(ATTACHMENT_CLOSE, open);
    out = close === -1 ? out.slice(0, open) : out.slice(0, open) + out.slice(close + ATTACHMENT_CLOSE.length);
  }
  return out.trim();
}
