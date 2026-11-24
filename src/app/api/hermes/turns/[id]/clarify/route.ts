import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { hermesClient } from "@/lib/hermes/client";
import { HermesError } from "@/lib/hermes/client-core";
import { toHermesClarifyAnswers, type ClarifyAnswer } from "@/lib/hermes/contract";
import { describeHermesError } from "@/lib/hermes/errors";
import { clarifyQuestionsOf } from "@/lib/hermes/stream-view";
import type { RelayEvent } from "@/lib/hermes/stream-view";
import { ownsTurn } from "@/lib/hermes/turn-owners";
import { turnLogOf } from "@/lib/hermes/turn-pump";
import { readJsonObject } from "@/lib/json-body";

/**
 * Hermesの選択肢つきの質問（`clarify`）への回答（#1150）。実行中のターンの持ち主だけが答えられる。
 * 回答は、そのターンで受けた質問（溜め `turn-pump.ts` の `clarify` イベント）と突き合わせてから送る。ブリッジでも検証し直す。
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const { id } = await context.params;
  const body = await readJsonObject(request);
  const requestId = body?.requestId;
  if (!body || typeof requestId !== "string" || requestId === "" || requestId.length > 128) {
    return NextResponse.json({ error: "回答の指定が正しくありません。" }, { status: 400 });
  }
  if (!ownsTurn(id, user.id)) return NextResponse.json({ error: describeHermesError("turn_not_found").message }, { status: 404 });

  const log = turnLogOf<RelayEvent>(id, user.id);
  const questions = log ? clarifyQuestionsOf(log.since(0), requestId) : null;
  if (!questions) return NextResponse.json({ error: "この質問はもう答えられません。" }, { status: 404 });
  if (!toHermesClarifyAnswers(questions, body.answers)) {
    return NextResponse.json({ error: "回答の形が正しくありません。" }, { status: 400 });
  }

  try {
    await (await hermesClient()).answerClarify(id, requestId, body.answers as Record<string, ClarifyAnswer>);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const failure = describeHermesError(error instanceof HermesError ? error.kind : "unreachable");
    return NextResponse.json({ error: failure.message, kind: failure.kind }, { status: failure.status });
  }
}
