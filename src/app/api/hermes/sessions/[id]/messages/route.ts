import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { hermesClient } from "@/lib/hermes/client";
import { HermesError } from "@/lib/hermes/client-core";
import { SESSION_ID_PATTERN } from "@/lib/hermes/contract";
import { describeHermesError } from "@/lib/hermes/errors";

/**
 * 会話の履歴（#929）。チャット画面が開いたとき、端末に覚えたセッションidの前回の会話を取り直す。
 * ブリッジの `GET /sessions/<id>/messages`（#752）を中継するだけで、Morrowは保存しない。
 */

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const { id } = await context.params;
  if (!SESSION_ID_PATTERN.test(id) || /^\.+$/.test(id)) {
    return NextResponse.json({ error: "会話の指定が正しくありません。", kind: "invalid" }, { status: 400 });
  }

  try {
    const history = await (await hermesClient()).history(id);
    return NextResponse.json({ messages: history.messages, hasMore: history.hasMore });
  } catch (error) {
    const failure = describeHermesError(error instanceof HermesError ? error.kind : "unreachable");
    return NextResponse.json({ error: failure.message, kind: failure.kind }, { status: failure.status });
  }
}
