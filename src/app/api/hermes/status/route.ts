import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { hermesStatus } from "@/lib/hermes/client";

/** 接続状態（#794。`/health` を30秒キャッシュ）。チャット画面の帯と「再試行」が使う。 */

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  return NextResponse.json(await hermesStatus());
}
