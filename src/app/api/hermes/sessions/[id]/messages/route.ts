import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { hermesClient } from "@/lib/hermes/client";
import { HermesError } from "@/lib/hermes/client-core";
import { SESSION_ID_PATTERN } from "@/lib/hermes/contract";
import { describeHermesError } from "@/lib/hermes/errors";
import { ownsHermesSession } from "@/lib/hermes/session-owner";

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

  // 持ち主の照合（#937）。他の利用者・持ち主不明のセッションは、無いときと同じ404（有無を見せない）
  if (!(await ownsHermesSession(user.id, id))) {
    const failure = describeHermesError("no_session");
    return NextResponse.json({ error: failure.message, kind: failure.kind }, { status: failure.status });
  }

  try {
    const history = await (await hermesClient()).history(id);
    return NextResponse.json({ messages: history.messages, hasMore: history.hasMore });
  } catch (error) {
    // 画面は「読み込めませんでした」としか出さないので、原因の切り分け用にログへ残す（#1145。古いブリッジが履歴APIを持たず
    // 404 `not_found`→`bad_response` になっていたのが、画面からもログからも見えなかった）。会話の本文・トークンは含まない
    const kind = error instanceof HermesError ? error.kind : "unreachable";
    if (kind !== "no_session") {
      console.warn(`[hermes] 履歴の取得に失敗（${kind}）`, error instanceof Error ? error.message : String(error));
    }
    const failure = describeHermesError(kind);
    return NextResponse.json({ error: failure.message, kind: failure.kind }, { status: failure.status });
  }
}
