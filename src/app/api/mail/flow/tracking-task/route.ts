import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { readJsonObject } from "@/lib/json-body";
import { isMailMessageId } from "@/lib/mail/contract";
import { normalizeSuggestion } from "@/lib/mail/suggest-core";
import { isAttachableTracking } from "@/lib/mail/tracking-task";
import { appendTrackingToTask } from "@/lib/mail/tracking-task-server";

/**
 * 追跡番号を既存タスクのメモへ書き足す（#1211）。`{ "id": "<メールID>", "taskId": "…", "carrier": "sagawa", "number": "…" }`。
 * **受け取るのは番号と追記先だけで、書き足す文はサーバーが作る。** 持ち主の照合は `appendTrackingToTask()` の中。
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const body = await readJsonObject(request);
  if (!isMailMessageId(body?.id)) return NextResponse.json({ error: "メールの指定が不正です。" }, { status: 400 });
  const taskId = typeof body.taskId === "string" && /^[!-~]{1,120}$/.test(body.taskId) ? body.taskId : null;
  const tracking = normalizeSuggestion("tracking", { carrier: body.carrier, number: body.number });
  if (!taskId || tracking?.kind !== "tracking" || !isAttachableTracking(tracking.fields)) {
    return NextResponse.json({ error: "追記先のタスク・配送会社・追跡番号を確かめてください。" }, { status: 400 });
  }

  const result = await appendTrackingToTask(user, body.id, taskId, tracking.fields);
  if (!result.ok) {
    const status =
      result.kind === "not_owner" ? 403 : result.kind === "invalid" ? 400 : result.kind === "not_found" ? 404 : result.kind === "conflict" ? 409 : result.kind === "unconfigured" ? 503 : 502;
    return NextResponse.json({ error: result.message, kind: result.kind }, { status });
  }
  return NextResponse.json({ status: result.status, message: result.message });
}
