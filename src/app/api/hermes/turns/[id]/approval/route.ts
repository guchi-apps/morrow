import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { hermesClient } from "@/lib/hermes/client";
import { HermesError } from "@/lib/hermes/client-core";
import { isApprovalChoice } from "@/lib/hermes/contract";
import { describeHermesError } from "@/lib/hermes/errors";
import { ownsTurn } from "@/lib/hermes/turn-owners";
import { readJsonObject } from "@/lib/json-body";

/**
 * Hermesの `approval` への回答（#794）。**`once`・`deny` だけ**（`always`・`session` は出さず、ブリッジでも受け付けない。`docs/hermes-actions.md`）。
 * 実行中のターンの持ち主だけが答えられる。
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const { id } = await context.params;
  const body = await readJsonObject(request);
  if (!body || typeof body.requestId !== "string" || body.requestId === "" || !isApprovalChoice(body.choice)) {
    return NextResponse.json({ error: "回答の指定が正しくありません。" }, { status: 400 });
  }
  if (!ownsTurn(id, user.id)) return NextResponse.json({ error: describeHermesError("turn_not_found").message }, { status: 404 });

  try {
    await (await hermesClient()).answerApproval(id, body.requestId, body.choice);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const failure = describeHermesError(error instanceof HermesError ? error.kind : "unreachable");
    return NextResponse.json({ error: failure.message, kind: failure.kind }, { status: failure.status });
  }
}
