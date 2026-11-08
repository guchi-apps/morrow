import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { readJsonObject } from "@/lib/json-body";
import { analyzeMail } from "@/lib/mail/analyze";
import { MAIL_FAILURE_MESSAGES, isMailMessageId } from "@/lib/mail/contract";

/**
 * メールのAI分析（#766）。`{ "id": "<メールID>", "refresh"?: true }` の本文をCodexに読ませ、要約と提案を返す。
 * メールを開いたときに画面が自動で呼ぶ。結果はプロセス内に30分だけ持つ（`refresh` で取り直す）。DBには保存しない。
 * 持ち主の照合は `analyzeMail()` の中（`getMail()`）。Codexの実行が終わるまで待つ。
 */

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const body = await readJsonObject(request);
  if (!isMailMessageId(body?.id)) return NextResponse.json({ error: "メールの指定が不正です。" }, { status: 400 });

  const result = await analyzeMail(user, body.id, { refresh: body.refresh === true });
  if (!result.ok) {
    const status = result.kind === "busy" ? 429 : result.kind === "not_owner" ? 403 : result.kind === "not_found" ? 404 : 502;
    const error = result.message ?? (result.kind === "busy" || result.kind === "failed" ? "分析できませんでした。" : MAIL_FAILURE_MESSAGES[result.kind]);
    return NextResponse.json({ error, kind: result.kind }, { status });
  }
  return NextResponse.json({ ...result.result, cached: result.cached });
}
