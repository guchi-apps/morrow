import type { MailAttachment } from "@/lib/mail/contract";

/**
 * メール本文の画像（#1101。純粋。`test/mail-body-images.test.ts`）。
 *
 * - 外部画像（`https:`）: 「画像を表示」を押したときだけ枠の中で読み込む（既存の `mailSrcdoc()`）。一覧では元の画像を開くだけで、
 *   **Morrowのサーバーからは取りに行かない**（任意のURLを取りに行く口はSSRFの穴になる）
 * - 埋め込み画像（`cid:`）: 添付の部品（`contentId`）と照合し、画面がMorrowの中継（`?mode=view`）から取って `data:` に差し替える。
 *   枠は `allow-same-origin` を持たずMorrowのCookieが届かないため、URLのままでは読めない
 */

const URL_LIMIT = 30;
/** 本文に差し替える埋め込み画像の上限（1枚5MB・20枚）。超えたものは添付ファイルの一覧に回す（data: にすると枠の文書が膨らむ）。 */
export const EMBED_MAX_BYTES = 5 * 1024 * 1024;
export const EMBED_MAX_COUNT = 20;

/** 本文の `cid:` 参照（小文字・パーセント復号済みの `contentId`）。 */
export function cidReferences(html: string): string[] {
  const out = new Set<string>();
  for (const match of html.matchAll(/cid:([^"'\s)>]+)/gi)) {
    out.add(normalizeCid(match[1]!));
  }
  return [...out];
}

function normalizeCid(value: string): string {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // 壊れた%は元のまま
  }
  return decoded.trim().replace(/^<|>$/g, "").toLowerCase();
}

/** 本文から参照されている埋め込み画像（取り出せるものだけ）。 */
export function embeddedImages(html: string, attachments: MailAttachment[]): MailAttachment[] {
  const refs = new Set(cidReferences(html));
  return attachments
    .filter((a) => a.attachmentId !== null && a.contentId !== null && a.size <= EMBED_MAX_BYTES && refs.has(a.contentId.toLowerCase()))
    .slice(0, EMBED_MAX_COUNT);
}

/** 添付ファイルの一覧に出すもの（本文に埋め込まれて画像として出るものは除く）。 */
export function listedAttachments(html: string | null, attachments: MailAttachment[]): MailAttachment[] {
  const embedded = new Set(html ? embeddedImages(html, attachments) : []);
  return attachments.filter((a) => !embedded.has(a));
}

/** `cid:` を `data:` に差し替える。対応の無い参照はそのまま（枠のCSPで読み込まれない）。 */
export function replaceCids(html: string, dataUrls: Map<string, string>): string {
  if (dataUrls.size === 0) return html;
  return html.replace(/cid:([^"'\s)>]+)/gi, (whole, ref: string) => dataUrls.get(normalizeCid(ref)) ?? whole);
}

/** 本文の外部画像のURL（`https:` のみ・重複なし・1×1の計測用画像は除く）。 */
export function externalImageUrls(html: string): string[] {
  const out: string[] = [];
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    if (/\b(width|height)\s*=\s*["']?\s*[01](px)?\s*["'\s>/]/i.test(tag)) continue;
    const src = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const raw = decodeEntities((src?.[1] ?? src?.[2] ?? src?.[3] ?? "").trim());
    if (!/^https:\/\//i.test(raw)) continue;
    try {
      const url = new URL(raw).toString();
      if (!out.includes(url)) out.push(url);
    } catch {
      continue;
    }
    if (out.length >= URL_LIMIT) break;
  }
  return out;
}

function decodeEntities(value: string): string {
  return value.replace(/&amp;/gi, "&").replace(/&#x26;|&#38;/gi, "&");
}

/** 添付の中継のURL。 */
export function attachmentUrl(messageId: string, attachmentId: string, mode: "check" | "view" | "download", extra: Record<string, string> = {}): string {
  const query = new URLSearchParams({ mode, ...extra });
  return `/api/mail/attachments/${encodeURIComponent(messageId)}/${encodeURIComponent(attachmentId)}?${query}`;
}
