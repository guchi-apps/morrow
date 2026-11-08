import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { cancelProposal } from "@/lib/hermes/proposals";

/** 提案を取り下げる（#748）。承認待ちと結果不明の行だけ。値はここで消える。 */

export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const { id } = await context.params;
  const result = await cancelProposal(user.id, id);
  if (!result.ok) return NextResponse.json({ error: result.message, proposal: result.view ?? null }, { status: result.status });
  return NextResponse.json({ proposal: result.view });
}
