import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { listProposals } from "@/lib/hermes/proposals";

/** 確認カード用の提案の一覧（#748）。直近24時間ぶん。期限切れの掃除もここで進める。 */

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  return NextResponse.json({ proposals: await listProposals(user.id) });
}
