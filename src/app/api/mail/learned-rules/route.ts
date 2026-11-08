import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { jstDayKey } from "@/lib/day-key";
import { readJsonObject } from "@/lib/json-body";
import { saveLearnedRules } from "@/lib/mail/learn";
import { normalizeLearnedRules } from "@/lib/mail/learn-core";

/**
 * 学習した傾向（#833）の一覧を置き換える。`{ "rules": [{ "text", "notify", "at" }] }`。画面の「削除」が残りを送る。
 * 判定のプロンプトへ入る値なので `normalizeLearnedRules()`（改行・制御文字を畳み、長さ・件数を制限）を通す。
 */

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const body = await readJsonObject(request);
  if (!Array.isArray(body?.rules)) return NextResponse.json({ error: "傾向の形が不正です。" }, { status: 400 });
  const rules = normalizeLearnedRules(body.rules, jstDayKey(new Date()));
  await saveLearnedRules(user.id, rules);
  return NextResponse.json({ rules });
}
