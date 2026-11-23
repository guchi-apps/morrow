import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { hermesClient } from "@/lib/hermes/client";
import { HermesError } from "@/lib/hermes/client-core";
import { describeHermesError } from "@/lib/hermes/errors";

/**
 * 会話の一覧（#1156）。ブリッジの `GET /sessions`（Morrowのセッションの題名・最終更新・件数）を読み、
 * **`HermesSession`（#937）で自分のものだけ**に絞って返す。他の利用者・持ち主不明のセッションは載せない。
 * Morrowは会話の本文を保存しない（題名・件数もここを通るだけ）。
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  try {
    const listed = await (await hermesClient()).listSessions({ limit: 100 });
    const owned = await db.hermesSession.findMany({
      where: { userId: user.id, sessionId: { in: listed.map((s) => s.sessionId) } },
      select: { sessionId: true },
    });
    const mine = new Set(owned.map((row) => row.sessionId));
    return NextResponse.json({ sessions: listed.filter((s) => mine.has(s.sessionId)) });
  } catch (error) {
    const kind = error instanceof HermesError ? error.kind : "unreachable";
    console.warn(`[hermes] 会話一覧の取得に失敗（${kind}）`, error instanceof Error ? error.message : String(error));
    const failure = describeHermesError(kind);
    return NextResponse.json({ error: failure.message, kind: failure.kind }, { status: failure.status });
  }
}
