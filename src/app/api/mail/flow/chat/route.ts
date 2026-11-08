import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { readJsonObject } from "@/lib/json-body";
import { chatAboutMail } from "@/lib/mail/chat";
import { normalizeChatHistory, normalizeChatMessage } from "@/lib/mail/chat-core";
import { MAIL_FAILURE_MESSAGES, isMailMessageId } from "@/lib/mail/contract";

/**
 * メール本文への指示（#784）。`{ "id": "<メールID>", "message": "<指示>", "history"?: [{ role, text }] }` を受け、
 * 本文を読んだCodexの返事と、必要なら処理の提案（登録はしない。行を押して `/apply` から）を返す。
 * やり取りは保存しない（`history` は画面が毎回送り直す。長さは `normalizeChatHistory()` で制限）。
 * 持ち主の照合は `chatAboutMail()` の中（`getMail()`）。Codexの実行が終わるまで待つ。
 */

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const body = await readJsonObject(request);
  if (!isMailMessageId(body?.id)) return NextResponse.json({ error: "メールの指定が不正です。" }, { status: 400 });
  const message = normalizeChatMessage(body.message);
  if (!message) return NextResponse.json({ error: "指示を書いてください。" }, { status: 400 });

  const result = await chatAboutMail(user, body.id, message, normalizeChatHistory(body.history));
  if (!result.ok) {
    const status = result.kind === "busy" ? 429 : result.kind === "not_owner" ? 403 : result.kind === "not_found" ? 404 : 502;
    const error = result.message ?? (result.kind === "busy" || result.kind === "failed" ? "返事を作れませんでした。" : MAIL_FAILURE_MESSAGES[result.kind]);
    return NextResponse.json({ error, kind: result.kind }, { status });
  }
  return NextResponse.json(result.result);
}
