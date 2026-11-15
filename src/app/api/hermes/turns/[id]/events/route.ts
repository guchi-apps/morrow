import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import type { RelayEvent } from "@/lib/hermes/stream-view";
import { turnLogOf } from "@/lib/hermes/turn-pump";
import { streamOf } from "@/lib/hermes/turn-stream";

/**
 * 切れた画面が、実行中（または終わったばかり）のターンの続きを受け直す（#1000）。`?after=<すでに受けたイベント数>`。
 * 溜めが無い（再起動・期限切れ・溜めきれなかった）ときは404/410で、画面は従来の「途中で止まりました」にする。
 */

export const dynamic = "force-dynamic";
export const maxDuration = 660;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const { id } = await context.params;
  const raw = new URL(request.url).searchParams.get("after") ?? "0";
  if (!/^\d{1,6}$/.test(raw)) return NextResponse.json({ error: "afterが不正です。" }, { status: 400 });
  const after = Number(raw);

  const log = turnLogOf<RelayEvent>(id, user.id);
  if (!log) return NextResponse.json({ error: "続きを受けられませんでした。", kind: "turn_not_found" }, { status: 404 });
  if (log.truncated || after > log.length) {
    return NextResponse.json({ error: "続きを受けられませんでした。", kind: "turn_expired" }, { status: 410 });
  }

  return new Response(streamOf(log, after), {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
