/** 返信の本文を「文章」と「URL」に分ける（#810）。純粋関数（DB・Reactに触れない）。 */

export type LinkPart = { type: "text"; text: string } | { type: "link"; text: string; href: string };

// URLに使える文字（ASCII）だけを拾う。日本語の句読点・かぎ括弧はここに入らないので自然に切れる。
const URL_PATTERN = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/g;

// 文末の句読点・記号はURLに含めない側へ倒す。
const TRAILING = /[.,;:!?'*]+$/;

function trimUrl(raw: string): string {
  let url = raw;
  for (;;) {
    const before = url;
    url = url.replace(TRAILING, "");
    // 閉じ括弧は、対応する開き括弧がURLの中に無いときだけ外す（Wikipediaの `_(x)` を壊さない）
    if (url.endsWith(")") && count(url, ")") > count(url, "(")) url = url.slice(0, -1);
    if (url.endsWith("]") && count(url, "]") > count(url, "[")) url = url.slice(0, -1);
    if (url === before) return url;
  }
}

function count(text: string, ch: string): number {
  return text.split(ch).length - 1;
}

/** http(s)のURLだけをリンクにする。`javascript:` などは対象外。 */
export function splitLinks(text: string): LinkPart[] {
  const parts: LinkPart[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = trimUrl(match[0]);
    // スキームだけ（`https://`）になったものはリンクにしない
    if (!/^https?:\/\/[^/?#]/.test(url)) continue;
    const start = match.index;
    if (start > last) parts.push({ type: "text", text: text.slice(last, start) });
    parts.push({ type: "link", text: url, href: url });
    last = start + url.length;
  }
  if (last < text.length) parts.push({ type: "text", text: text.slice(last) });
  return parts;
}
