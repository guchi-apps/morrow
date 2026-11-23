import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { hermesClient } from "@/lib/hermes/client";
import { HermesError } from "@/lib/hermes/client-core";
import { describeHermesError } from "@/lib/hermes/errors";
import { SKILL_NAME_PATTERN } from "@/lib/hermes/skill-core";

/** 登録済みスキルの削除（#1154）。同梱スキルはブリッジが断る（`skill_rejected`）。 */

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, context: { params: Promise<{ name: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const { name } = await context.params;
  if (!SKILL_NAME_PATTERN.test(name)) return NextResponse.json({ error: "スキル名の形が正しくありません。" }, { status: 400 });

  try {
    await (await hermesClient()).deleteSkill(name);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const kind = error instanceof HermesError ? error.kind : "unreachable";
    console.warn(`[hermes] スキルの削除に失敗（${kind}）`, error instanceof Error ? error.message : String(error));
    const failure = describeHermesError(kind);
    return NextResponse.json({ error: failure.message, kind: failure.kind }, { status: failure.status });
  }
}
