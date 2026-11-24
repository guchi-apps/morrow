import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { hermesClient } from "@/lib/hermes/client";

/**
 * 記憶の確認待ちの件数（#1155。左メニューのバッジ用）。ナッジの自動見直しが後から作った保留は通知されないので、これで補う。
 * 取れなかったときは `count: null`（0と混ぜない。画面はバッジを出さないだけ）。
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  try {
    const pending = await (await hermesClient()).pendingMemories();
    return NextResponse.json({ count: pending.length });
  } catch {
    return NextResponse.json({ count: null });
  }
}
