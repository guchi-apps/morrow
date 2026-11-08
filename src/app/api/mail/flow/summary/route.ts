import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { readJsonObject } from "@/lib/json-body";
import { MAIL_FAILURE_MESSAGES, isMailMessageId } from "@/lib/mail/contract";
import { summarizeMail } from "@/lib/mail/summary";

/**
 * メールの要約（#717）。`{ "id": "<メールID>" }` の本文をCodexに読ませ、要約と要点を返す。何も保存しない。
 * 持ち主の照合は `summarizeMail()` の中（`getMail()`）。
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const body = await readJsonObject(request);
  if (!isMailMessageId(body?.id)) return NextResponse.json({ error: "メールの指定が不正です。" }, { status: 400 });

  const result = await summarizeMail(user, body.id);
  if (!result.ok) {
    const status = result.kind === "busy" ? 429 : result.kind === "not_owner" ? 403 : result.kind === "not_found" ? 404 : 502;
    const error = result.message ?? (result.kind === "busy" || result.kind === "failed" ? "要約を作れませんでした。" : MAIL_FAILURE_MESSAGES[result.kind]);
    return NextResponse.json({ error, kind: result.kind }, { status });
  }
  return NextResponse.json(result.result);
}
