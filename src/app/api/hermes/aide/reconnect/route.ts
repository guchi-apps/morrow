import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { aideActionFailure, runAideAction } from "@/lib/hermes/aide-action";
import { hermesClient, rememberAideHealth } from "@/lib/hermes/client";
import { isHermesProfileOwner, PROFILE_OWNER_ONLY_MESSAGE } from "@/lib/hermes/profile-owner";

/**
 * AIDEの道具の「再接続する」（#1240）。HermesのMCPを張り直し（`reload.mcp`）、張り直した後の状態を返す。
 * Hermesのプロンプトキャッシュが捨てられるので、押したときだけ呼ぶ。
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  // 共有profileの設定を動かすので、持ち主だけ（#1188）
  if (!isHermesProfileOwner(user)) return NextResponse.json({ error: PROFILE_OWNER_ONLY_MESSAGE }, { status: 403 });

  try {
    const aide = await runAideAction(async () => (await hermesClient()).reconnectAide());
    rememberAideHealth(aide);
    return NextResponse.json({ aide });
  } catch (error) {
    return aideActionFailure(error);
  }
}
