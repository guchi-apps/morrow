import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { jstDayKey } from "@/lib/day-key";
import { readJsonObject } from "@/lib/json-body";
import { MAIL_FAILURE_MESSAGES, isMailMessageId } from "@/lib/mail/contract";
import { learnFromMail, saveLearnedRules } from "@/lib/mail/learn";
import { normalizeLearnedRules } from "@/lib/mail/learn-core";

/**
 * メールに付ける印（#833）。
 *
 * - `POST { "id": "<メールID>", "notify": true|false }`: 印を付け、AIがそこから傾向を読み取って一覧を更新する。
 *   Codexが終わるまで待つ（数十秒）。持ち主の照合は `learnFromMail()` の中（`getMail()`）
 * - `DELETE { "id": "<メールID>", "restore"?: [傾向…] }`: 印を外す（「取り消す」）。`restore` があれば傾向の一覧を
 *   押す前の状態へ戻す（画面が `POST` の応答で受け取った `previous` を送り返す。`normalizeLearnedRules()` で均す）
 */

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const body = await readJsonObject(request);
  if (!isMailMessageId(body?.id)) return NextResponse.json({ error: "メールの指定が不正です。" }, { status: 400 });
  if (typeof body.notify !== "boolean") return NextResponse.json({ error: "知らせるかどうかを指定してください。" }, { status: 400 });

  const result = await learnFromMail(user, body.id, body.notify);
  if (!result.ok) {
    const status = result.kind === "busy" ? 429 : result.kind === "not_owner" ? 403 : result.kind === "not_found" ? 404 : 502;
    const error = result.message ?? (result.kind === "busy" || result.kind === "failed" ? "学習できませんでした。" : MAIL_FAILURE_MESSAGES[result.kind]);
    return NextResponse.json({ error, kind: result.kind }, { status });
  }
  return NextResponse.json({ rules: result.rules, previous: result.previous, learned: result.learned });
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const body = await readJsonObject(request);
  if (!isMailMessageId(body?.id)) return NextResponse.json({ error: "メールの指定が不正です。" }, { status: 400 });

  await db.mailFeedback.deleteMany({ where: { userId: user.id, messageId: body.id } });
  if (body.restore === undefined) return NextResponse.json({ ok: true });
  if (!Array.isArray(body.restore)) return NextResponse.json({ error: "戻す傾向の形が不正です。" }, { status: 400 });
  const rules = normalizeLearnedRules(body.restore, jstDayKey(new Date()));
  await saveLearnedRules(user.id, rules);
  return NextResponse.json({ ok: true, rules });
}
