import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { readJsonObject } from "@/lib/json-body";
import { getMail } from "@/lib/mail/aide-client";
import { isMailMessageId } from "@/lib/mail/contract";
import { saveFlowRecord } from "@/lib/mail/flow-record";
import { normalizeSuggestion } from "@/lib/mail/suggest-core";

/**
 * サブスク一覧を開いたことを控えに残す（#750）。`{ "id": "<メールID>", "fields": {…} }`。
 * Morrowは登録できないので、状態は「opened」（登録は未確認）。値はサーバーで検証し直し、持ち主を照合してから残す。
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const body = await readJsonObject(request);
  if (!isMailMessageId(body?.id)) return NextResponse.json({ error: "メールの指定が不正です。" }, { status: 400 });
  const suggestion = normalizeSuggestion("subscription", body.fields);
  if (!suggestion) return NextResponse.json({ error: "入力内容が不正です。" }, { status: 400 });

  const mail = await getMail(user, body.id);
  if (!mail.ok) return NextResponse.json({ error: "メールを確認できませんでした。", kind: mail.kind }, { status: mail.kind === "not_owner" ? 403 : 502 });

  await saveFlowRecord(user.id, body.id, suggestion, "opened");
  return NextResponse.json({ ok: true });
}
