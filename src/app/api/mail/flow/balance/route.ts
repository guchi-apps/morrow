import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { readJsonObject } from "@/lib/json-body";
import { recheckBalance } from "@/lib/mail/analyze";
import { MAIL_FAILURE_MESSAGES, isMailMessageId } from "@/lib/mail/contract";

/**
 * 引き落とし前の残高確認の取り直し（#842）。`{ "id": "<メールID>", "account"?: "<残高の一覧にある口座名>" }`（口座名がメールに無いとき利用者が選ぶ。保存しない。#909）。Codexは走らせず、AIDEの残高だけを引き直す。
 * 引き落としの読み取りは分析の記憶から取る。持ち主の照合は `recheckBalance()` の中（`getMail()`）。
 */

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const body = await readJsonObject(request);
  if (!isMailMessageId(body?.id)) return NextResponse.json({ error: "メールの指定が不正です。" }, { status: 400 });

  const result = await recheckBalance(user, body.id, typeof body.account === "string" ? body.account : undefined);
  if (!result.ok) {
    const status = result.kind === "no_analysis" ? 409 : result.kind === "not_owner" ? 403 : result.kind === "not_found" ? 404 : 502;
    const error = result.message ?? (result.kind === "no_analysis" ? "分析の結果が残っていません。" : MAIL_FAILURE_MESSAGES[result.kind]);
    return NextResponse.json({ error, kind: result.kind }, { status });
  }
  return NextResponse.json({ balance: result.check });
}
