import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { readJsonObject } from "@/lib/json-body";
import { isMailAttachmentId, isMailMessageId } from "@/lib/mail/contract";
import { commitSalary, previewSalary } from "@/lib/mail/salary";
import { isSalaryRecordId } from "@/lib/mail/salary-core";

/**
 * メールの給与明細PDFをAsset Managerの給与台帳へ取り込む（#1170）。利用者が押したときだけ呼ばれる。
 *
 * - `{ action: "preview", messageId, attachmentId }`: PDFを解析して承認待ちの記録を作る（保存はしない）
 * - `{ action: "commit", previewId }`: 本人がAsset Managerの画面で承認した後に保存し、読み戻す
 *
 * 持ち主の照合は `getMailAttachment()`（`salary.ts`）。`previewToken` は返さない。
 */

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const body = await readJsonObject(request);
  if (body?.action === "preview") {
    if (!isMailMessageId(body.messageId) || !isMailAttachmentId(body.attachmentId)) {
      return NextResponse.json({ error: "添付ファイルの指定が不正です。" }, { status: 400 });
    }
    const outcome = await previewSalary(user, body.messageId, body.attachmentId);
    if (!outcome.ok) return NextResponse.json({ error: outcome.failure.message, manual: outcome.failure.manual }, { status: outcome.status });
    return NextResponse.json({ preview: outcome.preview });
  }
  if (body?.action === "commit") {
    if (!isSalaryRecordId(body.previewId)) return NextResponse.json({ error: "指定が不正です。" }, { status: 400 });
    const outcome = await commitSalary(user, body.previewId);
    if (!outcome.ok) return NextResponse.json({ error: outcome.failure.message, manual: outcome.failure.manual }, { status: outcome.status });
    return NextResponse.json({ result: outcome.result });
  }
  return NextResponse.json({ error: "指定が不正です。" }, { status: 400 });
}
