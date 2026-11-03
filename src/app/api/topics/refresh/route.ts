import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { refreshTopicsNow } from "@/lib/topics";

/**
 * 話題を今すぐ仕入れる（#660）。話題画面の「最近の記事を取得する」ボタンが叩く。
 *
 * 話題の取得は、指定した時刻（定時のお知らせ・朝の見通しの直前）とこのボタンだけ。画面を開いても走らない。
 * 間隔は見ず、押されたら必ず取りに行く。**仕入れが終わるまで待って結果を返す**（1回30秒〜数分。
 * サブスク枠を使う）。同じ利用者の仕入れが走っている間は `busy`。
 */

export const dynamic = "force-dynamic";

export const maxDuration = 300;

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  }

  try {
    const result = await refreshTopicsNow(user.id);
    return NextResponse.json({ result });
  } catch (error) {
    console.error("[aide-bot] 話題の手動取得の前処理に失敗した", error);
    return NextResponse.json({ result: "failed" }, { status: 500 });
  }
}
