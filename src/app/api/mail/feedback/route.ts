import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { readJsonObject } from "@/lib/json-body";
import { MAIL_FAILURE_MESSAGES, isMailMessageId } from "@/lib/mail/contract";
import { learnFromMail, updateLearnedRules } from "@/lib/mail/learn";
import { normalizeLearnedRules, revertLearnResult } from "@/lib/mail/learn-core";

/**
 * メールに付ける印（#833）。
 *
 * - `POST { "id": "<メールID>", "notify": true|false }`: 印を付け、AIがそこから傾向を読み取って一覧を更新する。
 *   Codexが終わるまで待つ（数十秒）。持ち主の照合は `learnFromMail()` の中（`getMail()`）
 * - `DELETE { "id": "<メールID>", "revert"?: { "removed": [傾向…], "added": [傾向…] } }`: 印を外す（「取り消す」）。
 *   `revert` があれば、学習が当てた差分（画面が `POST` の応答で受け取った `change`）を**いまの一覧から**逆に当てる。
 *   押す前の一覧で丸ごと置き換えると、その後に別の画面で消した・直した傾向まで戻してしまう（#847）
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
    const status = result.kind === "busy" ? 429 : result.kind === "conflict" ? 409 : result.kind === "not_owner" ? 403 : result.kind === "not_found" ? 404 : 502;
    const error = result.message ?? (result.kind === "busy" || result.kind === "failed" || result.kind === "conflict" ? "学習できませんでした。" : MAIL_FAILURE_MESSAGES[result.kind]);
    return NextResponse.json({ error, kind: result.kind }, { status });
  }
  return NextResponse.json({ rules: result.rules, change: result.change, learned: result.learned });
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const body = await readJsonObject(request);
  if (!isMailMessageId(body?.id)) return NextResponse.json({ error: "メールの指定が不正です。" }, { status: 400 });

  const id = body.id;
  const removeFeedback = () => db.mailFeedback.deleteMany({ where: { userId: user.id, messageId: id } });
  if (body.revert === undefined) {
    await removeFeedback();
    return NextResponse.json({ ok: true });
  }
  const revert = body.revert as Record<string, unknown> | null;
  if (typeof revert !== "object" || revert === null || !Array.isArray(revert.removed) || !Array.isArray(revert.added)) {
    return NextResponse.json({ error: "戻す傾向の形が不正です。" }, { status: 400 });
  }
  const { removed, added } = revert;
  try {
    // 傾向を戻せてから印を外す（戻せなかった回に印だけ消えないように）
    const rules = await updateLearnedRules(user.id, (current, today) => {
      const change = { removed: normalizeLearnedRules(removed, today), added: normalizeLearnedRules(added, today) };
      const next = revertLearnResult(current, change, today);
      return { rules: next, result: next };
    });
    await removeFeedback();
    return NextResponse.json({ ok: true, rules });
  } catch (error) {
    console.error("[aide-bot] 学習の取り消しを保存できなかった", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "取り消せませんでした。もう一度試してください。" }, { status: 503 });
  }
}
