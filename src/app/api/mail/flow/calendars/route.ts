import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { eventCalendarChoices } from "@/lib/mail/calendars";

/**
 * 予定の保存先に選べるカレンダーの候補（#908）。`{ "ok": true, "calendars": [{ "id", "name" }] }`。
 * 取得できなかったときは `ok: false`（画面は「既定の保存先」だけで続ける）。メールには触れない。
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  return NextResponse.json(await eventCalendarChoices(user.id));
}
