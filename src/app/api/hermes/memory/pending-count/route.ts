import { NextResponse } from "next/server";

import { denyUnlessProfileOwner } from "@/lib/hermes/profile-owner";
import { hermesClient } from "@/lib/hermes/client";

/**
 * 記憶の確認待ちの件数（#1155。左メニューのバッジ用）。ナッジの自動見直しが後から作った保留は通知されないので、これで補う。
 * 取れなかったときは `count: null`（0と混ぜない。画面はバッジを出さないだけ）。
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await denyUnlessProfileOwner();
  if (denied) return denied;
  try {
    const pending = await (await hermesClient()).pendingMemories();
    return NextResponse.json({ count: pending.length });
  } catch {
    return NextResponse.json({ count: null });
  }
}
