import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { readJsonObject } from "@/lib/json-body";
import { updateLearnedRules } from "@/lib/mail/learn";
import { removeLearnedRule } from "@/lib/mail/learn-core";

/**
 * 学習した傾向（#833）を1件削除する。`{ "rule": { "text", "notify" } }`。画面の「削除」が名指しで送る。
 *
 * **画面が見ていた一覧で丸ごと置き換えない**（#847）。学習・取り消しが別のタブで同時に動いていても、
 * いまの一覧から名指しの1件だけを外す（`updateLearnedRules()` が他の書き込みと重なったら読み直す）。
 * 応答の `rules` はいまの一覧で、画面はこれで描き直す。
 */

export const dynamic = "force-dynamic";

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const body = await readJsonObject(request);
  const rule = body?.rule;
  if (typeof rule !== "object" || rule === null) return NextResponse.json({ error: "傾向の指定が不正です。" }, { status: 400 });
  const { text, notify } = rule as Record<string, unknown>;
  if (typeof text !== "string" || typeof notify !== "boolean") {
    return NextResponse.json({ error: "傾向の指定が不正です。" }, { status: 400 });
  }
  try {
    const rules = await updateLearnedRules(user.id, (current) => {
      const next = removeLearnedRule(current, { text, notify });
      return { rules: next, result: next };
    });
    return NextResponse.json({ rules });
  } catch (error) {
    console.error("[aide-bot] 学習した傾向を削除できなかった", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "削除できませんでした。もう一度試してください。" }, { status: 503 });
  }
}
