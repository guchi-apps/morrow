import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { readJsonObject } from "@/lib/json-body";
import { matchRegisteredSubscription } from "@/lib/mail/subscription-match";

/**
 * サブスク提案の名称をAsset Managerの登録済みと照合する（#884）。`{ "name": "<提案の名称>" }`。
 * 読むのはログイン中の利用者自身のAIDE接続の読み取り道具だけで、メールの本文には触れない（名称だけを受ける）。
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const body = await readJsonObject(request);
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 100) : "";
  if (!name) return NextResponse.json({ error: "名称の指定が不正です。" }, { status: 400 });

  return NextResponse.json(await matchRegisteredSubscription(user.id, name));
}
