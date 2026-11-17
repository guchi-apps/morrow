import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { readJsonObject } from "@/lib/json-body";
import { reorderTopicCategories } from "@/lib/topic-category-store";

/** 話題の種類の並び順を保存する（#1039）。本文は `{ keys: string[] }`（利用者の全キーの並び。別タブで増減していても合わせる）。 */

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "リクエストの形式が正しくありません。" }, { status: 400 });

  const categories = await reorderTopicCategories(user.id, body);
  if (!categories) {
    return NextResponse.json({ error: "並びが一覧と合いません。画面を開き直してください。" }, { status: 400 });
  }
  return NextResponse.json({ categories });
}
