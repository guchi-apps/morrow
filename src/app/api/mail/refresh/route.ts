import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { invalidateMailList } from "@/lib/mail/list-cache";

/**
 * 一覧の短期キャッシュ（#823）を捨てる（#1015）。引っ張って更新が、一覧の取り直し（`router.refresh()`）の前に呼ぶ。
 * AIDEには触れない軽い口で、新着の判定（`/api/mail/check`）とは別。
 */

export const dynamic = "force-dynamic";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  }
  invalidateMailList(user.id);
  return NextResponse.json({ ok: true });
}
