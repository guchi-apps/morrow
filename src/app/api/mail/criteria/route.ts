import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { readJsonObject } from "@/lib/json-body";
import { MAIL_CRITERIA_MAX, normalizeMailCriteria } from "@/lib/mail/triage-core";

/**
 * 「お知らせする基準」を保存する（#683）。`{ "criteria": "…" }`。空文字は既定の基準へ戻す。
 * 判定のプロンプトへそのまま入るので、改行・制御文字を畳み、長さを制限する（`normalizeMailCriteria()`）。
 */

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  }

  const body = await readJsonObject(request);
  const criteria = normalizeMailCriteria(body?.criteria);
  if (criteria === null) {
    return NextResponse.json({ error: `基準は${MAIL_CRITERIA_MAX}文字以内の文字列で指定してください。` }, { status: 400 });
  }

  await db.user.update({ where: { id: user.id }, data: { mailCriteria: criteria } });
  return NextResponse.json({ criteria });
}
