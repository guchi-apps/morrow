import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { unreadMailCount } from "@/lib/mail/unread-count";

/**
 * アプリアイコンのバッジ用の未読メール件数（#1144）。`{ enabled, count }`。
 * 設定がオフなら（`enabled: false`）AIDEへは取りに行かない。取れなかった回は `count: null`
 * （画面は前の数字のままにする。「0件」と混ぜない）。
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  if (!user.appBadgeEnabled) return NextResponse.json({ enabled: false, count: 0 });

  const unread = await unreadMailCount({ id: user.id, email: user.email });
  return NextResponse.json({ enabled: true, count: unread ? unread.count : null });
}
