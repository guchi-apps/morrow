import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { hermesClient } from "@/lib/hermes/client";
import { HermesError } from "@/lib/hermes/client-core";
import { describeHermesError } from "@/lib/hermes/errors";
import { hasBlockingIssue, PENDING_ID_PATTERN, reviewText, detectSensitive, validatePendingSkill } from "@/lib/hermes/skill-core";
import { readJsonObject } from "@/lib/json-body";

/**
 * 承認待ちのスキル1件の承認・却下（#1154）。`POST { action: "approve" | "discard", confirmed?: true }`。
 *
 * 承認は、**保留をブリッジから読み直して形式・長さを検証し直す**（画面の申告は信じない）。個人情報らしき文字列が
 * 見つかった保留は `confirmed: true`（「含まれていないことを確認した」）が無ければ断る。
 * 承認しない限りスキルは書かれない（却下はHermesの保留を消すだけ）。
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const { id } = await context.params;
  if (!PENDING_ID_PATTERN.test(id)) return NextResponse.json({ error: "idの形が正しくありません。" }, { status: 400 });
  const body = await readJsonObject(request);
  const action = body?.action;
  if (action !== "approve" && action !== "discard") return NextResponse.json({ error: "操作の指定が正しくありません。" }, { status: 400 });

  try {
    const client = await hermesClient();
    if (action === "discard") {
      await client.discardSkill(id);
      return NextResponse.json({ ok: true });
    }

    const skill = (await client.pendingSkills()).find((item) => item.id === id);
    if (!skill) return NextResponse.json({ error: "このスキル案は見つかりません（すでに処理された可能性があります）。" }, { status: 404 });

    const issues = validatePendingSkill(skill);
    if (hasBlockingIssue(issues)) {
      return NextResponse.json(
        { error: "形式の確認に通らないため承認できません。却下して、頼み直してください。", issues },
        { status: 422 },
      );
    }
    if (detectSensitive(reviewText(skill)).length > 0 && body?.confirmed !== true) {
      return NextResponse.json({ error: "個人情報らしき文字列が含まれていないか確認し、チェックを入れてください。" }, { status: 422 });
    }
    await client.approveSkill(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const kind = error instanceof HermesError ? error.kind : "unreachable";
    console.warn(`[hermes] スキルの${action === "approve" ? "承認" : "却下"}に失敗（${kind}）`, error instanceof Error ? error.message : String(error));
    const failure = describeHermesError(kind);
    return NextResponse.json({ error: failure.message, kind: failure.kind }, { status: failure.status });
  }
}
