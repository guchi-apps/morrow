/**
 * メール本文から「購読解除（配信停止）」のリンクを探す（#942）。DB・ネットワークに触れない。
 * `test/mail-unsubscribe.test.ts` が固定する。
 *
 * AIDEの本文応答には `List-Unsubscribe` ヘッダーが無いので、本文のHTML・テキストにあるリンクだけを手掛かりにする。
 * 見つからなければ null（出さない）。**Morrowはリンクを開くだけで、自動では押さない**（解除は利用者がサイトで行う）。
 * 外から来た文字列なので、`https:` の絶対URLだけを返す。
 */

const KEYWORDS = /unsubscribe|opt[-_ ]?out|配信停止|配信解除|購読解除|購読停止|メール配信の(?:停止|解除)|受信設定|配信設定/i;
const URL_LIMIT = 2000;

function safeHttps(raw: string): string | null {
  const decoded = raw.replace(/&amp;/gi, "&").trim();
  if (decoded === "" || decoded.length > URL_LIMIT) return null;
  try {
    const url = new URL(decoded);
    return url.protocol === "https:" && url.username === "" && url.password === "" ? url.toString() : null;
  } catch {
    return null;
  }
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ");
}

export function findUnsubscribeLink(html: string | null, text: string | null): string | null {
  if (html) {
    const anchor = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;
    let byText: string | null = null;
    while ((match = anchor.exec(html)) !== null) {
      const href = safeHttps(match[1] ?? match[2] ?? "");
      if (!href) continue;
      // URLに解除の語があるものを最優先、無ければリンクの文言で選ぶ
      if (KEYWORDS.test(href)) return href;
      if (byText === null && KEYWORDS.test(stripTags(match[3] ?? ""))) byText = href;
    }
    if (byText) return byText;
  }
  if (text) {
    for (const found of text.matchAll(/https:\/\/[^\s<>"')\]]+/gi)) {
      const href = safeHttps(found[0]);
      if (href && KEYWORDS.test(href)) return href;
    }
  }
  return null;
}
