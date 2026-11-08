import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { invalidateMailList } from "@/lib/mail/list-cache";
import { checkMailNow } from "@/lib/mail/triage";

/**
 * メールの新着を今すぐ確認する（#683）。メール画面の「いま確認」が叩く。
 *
 * 15分ごとのcronと同じ流れ（`checkMailForUser()`）を通る。持ち主の照合は `listMail()` の中。
 * 判定（Codex）が終わるまで待って結果を返す。続けて押した回は1分あける（`too_soon`）。
 */

export const dynamic = "force-dynamic";

export const maxDuration = 180;

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  }

  const result = await checkMailNow(user.id);
  invalidateMailList(user.id);
  const status = result.status === "not_owner" ? 403 : result.status === "failed" ? 502 : 200;
  return NextResponse.json({ result }, { status });
}
