import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { executeProposal } from "@/lib/hermes/proposals";
import { readJsonObject } from "@/lib/json-body";

/**
 * 承認された提案を実行する（#748）。`{ "fields": { …カードで直した値… } }`（直さなければ本文なしでよい）。
 * **値はサーバーで検証し直す。** `pending → executing` を1回だけ進めた側だけが実行するので、連打・複数端末でも1回しか走らない。
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const { id } = await context.params;
  const body = await readJsonObject(request);
  const result = await executeProposal(user.id, id, body?.fields);
  if (!result.ok) return NextResponse.json({ error: result.message, proposal: result.view ?? null }, { status: result.status });
  return NextResponse.json({ proposal: result.view });
}
