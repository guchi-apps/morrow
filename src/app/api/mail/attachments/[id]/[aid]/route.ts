import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { getMailAttachment } from "@/lib/mail/aide-client";
import { checkAttachmentContent, previewContentType, uncheckedAttachment } from "@/lib/mail/attachment-check";
import { attachmentDisposition } from "@/lib/mail/attachment-response";
import { MAIL_FAILURE_MESSAGES, isMailAttachmentId, isMailMessageId } from "@/lib/mail/contract";

/**
 * メールの添付1件（#1101）。AIDEの取り出し口（aide#867）を中継し、Morrowで中身を検査してから返す。
 *
 * - `?mode=check`（既定）: 判定（`AttachmentCheck`）だけをJSONで返す
 * - `?mode=view`: `safe` で、中身の署名が画像・PDFのものだけ、その場で開ける形（inline）で返す。本文の埋め込み画像（cid）もこれで取る
 * - `?mode=download`: 保存させる（attachment）。`danger` は断り、`caution` は `confirm=1` が無ければ断る
 *
 * 持ち主の照合は `getMailAttachment()`（応答の `owner`）。中身・ファイル名はDB・ログに残さない。
 * 応答は `nosniff`・`CSP: sandbox` を固定し、Morrowのオリジンでメール由来の内容が動かないようにする。
 */

export const dynamic = "force-dynamic";
export const maxDuration = 90;

type Params = { params: Promise<{ id: string; aid: string }> };

const SAFE_HEADERS = {
  "x-content-type-options": "nosniff",
  "content-security-policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
  "cache-control": "private, no-store",
  "referrer-policy": "no-referrer",
};

/**
 * PDFを開くときだけは `sandbox` を外す（Chromeは `sandbox` 付きのPDFを表示しない）。
 * 開けるのはスクリプト・起動動作の無い（`safe` の）PDFだけで、PDFの表示はブラウザ内蔵のビューアがページとは別に行う。
 */
const PDF_VIEW_HEADERS = { ...SAFE_HEADERS, "content-security-policy": "default-src 'none'; object-src 'self'" };

export async function GET(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const { id, aid } = await params;
  if (!isMailMessageId(id) || !isMailAttachmentId(aid)) return NextResponse.json({ error: "添付ファイルの指定が不正です。" }, { status: 400 });

  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") ?? "check";
  if (mode !== "check" && mode !== "view" && mode !== "download") return NextResponse.json({ error: "指定が不正です。" }, { status: 400 });

  const result = await getMailAttachment(user, id, aid);
  if (!result.ok) {
    if (result.kind === "too_large" && mode === "check") {
      // 取り出せない大きさのものは検査できない。名前だけの判定に「確かめられない」を足して返す
      const name = url.searchParams.get("name") ?? "";
      const type = url.searchParams.get("type") ?? "";
      return NextResponse.json({ check: uncheckedAttachment(name, type, "ファイルが大きすぎるため、中身を確かめられません（25MBまで）。"), downloadable: false });
    }
    const status = result.kind === "not_owner" ? 403 : result.kind === "not_found" ? 404 : result.kind === "too_large" ? 413 : result.kind === "invalid_request" ? 400 : 502;
    return NextResponse.json({ error: result.message ?? MAIL_FAILURE_MESSAGES[result.kind], kind: result.kind }, { status });
  }

  const { filename, mimeType, data } = result.value;
  const check = checkAttachmentContent(filename, mimeType, data);

  if (mode === "check") return NextResponse.json({ check, downloadable: check.verdict !== "danger" });

  if (mode === "view") {
    const type = previewContentType(data);
    if (check.verdict !== "safe" || !check.preview || !type) {
      return NextResponse.json({ error: "このファイルはMorrowの中では開けません。", check }, { status: 403 });
    }
    return new Response(toBody(data), {
      headers: { ...(type === "application/pdf" ? PDF_VIEW_HEADERS : SAFE_HEADERS), "content-type": type, "content-length": String(data.length), "content-disposition": attachmentDisposition("inline", filename) },
    });
  }

  if (check.verdict === "danger") return NextResponse.json({ error: "危険と判定したため、Morrowからは保存できません。", check }, { status: 403 });
  if (check.verdict === "caution" && url.searchParams.get("confirm") !== "1") {
    return NextResponse.json({ error: "注意が必要なファイルです。理由を確かめてから保存してください。", check }, { status: 409 });
  }
  // 種類は中身の署名で決めた値だけ（申告の種類は使わない）。分からなければ汎用のバイナリ
  return new Response(toBody(data), {
    headers: {
      ...SAFE_HEADERS,
      "content-type": previewContentType(data) ?? "application/octet-stream",
      "content-length": String(data.length),
      "content-disposition": attachmentDisposition("attachment", filename),
    },
  });
}

function toBody(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}
