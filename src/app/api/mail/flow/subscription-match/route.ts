import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { readJsonObject } from "@/lib/json-body";
import { MATCH_NAMES_MAX } from "@/lib/mail/subscription-match-core";
import { matchRegisteredSubscription } from "@/lib/mail/subscription-match";

/**
 * 提案（サブスク・家計簿）をAsset Managerの登録済みと照合する（#884・#896）。
 * `{ "names": ["<支払先・名称>", …], "amount": <1回あたりの金額|null>, "currency": "JPY"|"USD"|null }`（旧 `{ "name" }` も受ける）。
 * 読むのはログイン中の利用者自身のAIDE接続の読み取り道具だけで、メールの本文には触れない（名称と金額だけを受ける）。
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const body = await readJsonObject(request);
  const raw = Array.isArray(body?.names) ? body.names : [body?.name];
  const names = raw
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim().slice(0, 100))
    .filter(Boolean)
    .slice(0, MATCH_NAMES_MAX);
  const amount = typeof body?.amount === "number" && Number.isFinite(body.amount) ? body.amount : null;
  const currency = body?.currency === "JPY" || body?.currency === "USD" ? body.currency : null;
  if (names.length === 0 && amount === null) return NextResponse.json({ error: "名称・金額の指定が不正です。" }, { status: 400 });

  return NextResponse.json(await matchRegisteredSubscription(user.id, { names, amount, currency }));
}
