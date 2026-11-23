/**
 * 会話の題名（#1156。純粋）。新しい会話の最初の発言の先頭から短く作り、ターン開始の `title`（`session.create`）で送る。
 * 利用者が打った文だけが元で、Morrowが足す注記・メール本文・天気は含めない。Morrowのサーバーには保存しない。
 */

export const SESSION_TITLE_MAX = 30;

export function sessionTitleFrom(text: string): string | undefined {
  // 先頭の空でない1行。連続する空白・制御文字は1つの空白へ畳む
  const line = text.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  const folded = line.replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim();
  if (folded === "") return undefined;
  const chars = Array.from(folded);
  return chars.length > SESSION_TITLE_MAX ? `${chars.slice(0, SESSION_TITLE_MAX - 1).join("")}…` : folded;
}
