import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { isHermesProfileOwner, PROFILE_OWNER_ONLY_MESSAGE } from "@/lib/hermes/profile-owner";
import { hermesClient } from "@/lib/hermes/client";
import { HermesError } from "@/lib/hermes/client-core";
import { SESSION_LIST_MAX_LIMIT } from "@/lib/hermes/contract";
import { describeHermesError } from "@/lib/hermes/errors";

/**
 * 会話の一覧（#1156）。**`HermesSession`（#937）で自分のidを先に引き**、ブリッジの `GET /sessions?ids=`
 * （Morrowのセッションの題名・最終更新・件数）へ渡して返す。他の利用者・持ち主不明のセッションは載せない。
 * 自分のidは作成が新しい順に100件まで（それより古い会話は一覧に出ない）。
 * Morrowは会話の本文を保存しない（題名・件数もここを通るだけ）。
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  if (!isHermesProfileOwner(user)) return NextResponse.json({ error: PROFILE_OWNER_ONLY_MESSAGE }, { status: 403 });

  try {
    // 持ち主での絞り込みを先に行う（件数で切ってから絞ると、他の利用者・持ち主不明の会話に枠を取られて自分の会話が欠ける）
    const owned = await db.hermesSession.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: SESSION_LIST_MAX_LIMIT,
      select: { sessionId: true },
    });
    const sessions = await (await hermesClient()).listSessions(owned.map((row) => row.sessionId));
    return NextResponse.json({ sessions });
  } catch (error) {
    const kind = error instanceof HermesError ? error.kind : "unreachable";
    console.warn(`[hermes] 会話一覧の取得に失敗（${kind}）`, error instanceof Error ? error.message : String(error));
    const failure = describeHermesError(kind);
    return NextResponse.json({ error: failure.message, kind: failure.kind }, { status: failure.status });
  }
}
