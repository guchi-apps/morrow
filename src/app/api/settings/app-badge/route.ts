import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { readJsonObject } from "@/lib/json-body";

/** アプリアイコンのバッジのオン・オフ（#1144）。`{ "enabled": true | false }`。 */

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const body = await readJsonObject(request);
  if (!body || typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled は真偽値で指定してください。" }, { status: 400 });
  }

  await db.user.update({ where: { id: user.id }, data: { appBadgeEnabled: body.enabled } });
  return NextResponse.json({ ok: true, enabled: body.enabled });
}
