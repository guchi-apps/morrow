import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { readJsonObject } from "@/lib/json-body";
import { MAIL_FAILURE_MESSAGES, isMailMessageId } from "@/lib/mail/contract";
import { suggestForMail } from "@/lib/mail/suggest";

/**
 * メールの提案（#689）。`{ "id": "<メールID>" }` の本文をCodexに読ませ、おすすめと候補を返す。何も保存しない。
 * 持ち主の照合は `suggestForMail()` の中（`getMail()`）。Codexの実行が終わるまで待つ。
 */

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const body = await readJsonObject(request);
  if (!isMailMessageId(body?.id)) return NextResponse.json({ error: "メールの指定が不正です。" }, { status: 400 });

  const result = await suggestForMail(user, body.id);
  if (!result.ok) {
    const status = result.kind === "busy" ? 429 : result.kind === "not_owner" ? 403 : result.kind === "not_found" ? 404 : 502;
    const error = result.message ?? (result.kind === "busy" || result.kind === "failed" ? "提案を作れませんでした。" : MAIL_FAILURE_MESSAGES[result.kind]);
    return NextResponse.json({ error, kind: result.kind }, { status });
  }
  return NextResponse.json(result.result);
}
