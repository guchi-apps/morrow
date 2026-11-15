import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { readJsonObject } from "@/lib/json-body";
import { applyCardConfirmation } from "@/lib/mail/analyze";
import { MAIL_FAILURE_MESSAGES, isMailMessageId } from "@/lib/mail/contract";

/**
 * メールの確定額でAsset Managerのカード引き落とし見込みを上書きする（#910）。`{ "id": "<メールID>" }` だけを受け取る。
 * 額・日・カードは画面から受け取らず、サーバーが分析の記憶とAsset Managerの見込みの読み直しで決める。
 * 持ち主の照合は `applyCardConfirmation()` の中（`getMail()`）。利用者が確認して押したときだけ呼ばれる。
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const body = await readJsonObject(request);
  if (!isMailMessageId(body?.id)) return NextResponse.json({ error: "メールの指定が不正です。" }, { status: 400 });

  const result = await applyCardConfirmation(user, body.id);
  if (!result.ok) {
    const kind = "kind" in result ? result.kind : null;
    if (kind) {
      const status = kind === "no_analysis" ? 409 : kind === "not_owner" ? 403 : kind === "not_found" ? 404 : 502;
      return NextResponse.json({ error: result.message ?? MAIL_FAILURE_MESSAGES[kind as keyof typeof MAIL_FAILURE_MESSAGES] ?? "登録できませんでした。" }, { status });
    }
    return NextResponse.json({ error: result.message }, { status: 422 });
  }
  return NextResponse.json({ result: result.result, previousAmount: result.previousAmount, card: result.card });
}
