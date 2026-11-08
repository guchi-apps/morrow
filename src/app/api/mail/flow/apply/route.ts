import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { readJsonObject } from "@/lib/json-body";
import { isMailMessageId } from "@/lib/mail/contract";
import { applyFlow } from "@/lib/mail/suggest";
import { normalizeSuggestion } from "@/lib/mail/suggest-core";

/**
 * 承認された1件を実行する（#689）。`{ "id": "<メールID>", "kind": "task", "fields": {…}, "confidence": 0.8 }`。
 * **値はサーバーで検証し直す**（`normalizeSuggestion()`）。持ち主の照合は `applyFlow()` の中。
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const body = await readJsonObject(request);
  if (!isMailMessageId(body?.id)) return NextResponse.json({ error: "メールの指定が不正です。" }, { status: 400 });
  const suggestion = normalizeSuggestion(body.kind, body.fields, "", body.confidence);
  if (!suggestion) return NextResponse.json({ error: "入力内容が不正です。名称・題名を確かめてください。" }, { status: 400 });

  const result = await applyFlow(user, body.id, suggestion);
  if (!result.ok) {
    const status =
      result.kind === "not_owner" ? 403 : result.kind === "invalid" ? 400 : result.kind === "not_found" ? 404 : result.kind === "unconfigured" ? 503 : 502;
    return NextResponse.json({ error: result.message, kind: result.kind }, { status });
  }
  return NextResponse.json({ status: result.outcome.status, message: result.outcome.message, labeled: result.labeled });
}
