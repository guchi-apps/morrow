import { NextResponse } from "next/server";

import { denyUnlessProfileOwner } from "@/lib/hermes/profile-owner";
import { hermesClient } from "@/lib/hermes/client";
import { HermesError } from "@/lib/hermes/client-core";
import { describeHermesError } from "@/lib/hermes/errors";
import { detectSensitive, hasBlockingMemoryIssue, memoryReviewText, PENDING_ID_PATTERN, validatePendingMemory } from "@/lib/hermes/memory-core";
import { readJsonObject } from "@/lib/json-body";

/**
 * 承認待ちの記憶1件の承認・却下（#1155）。`POST { action: "approve" | "discard", confirmed?: true }`。
 *
 * 承認は、**保留をブリッジから読み直して形式・長さを検証し直す**（画面の申告は信じない。スキル版 #1154 と同じ）。
 * 個人情報らしき文字列が見つかった保留は `confirmed: true` が無ければ断る。承認しない限り記憶は書かれない（却下は保留を消すだけ）。
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await denyUnlessProfileOwner();
  if (denied) return denied;

  const { id } = await context.params;
  if (!PENDING_ID_PATTERN.test(id)) return NextResponse.json({ error: "idの形が正しくありません。" }, { status: 400 });
  const body = await readJsonObject(request);
  const action = body?.action;
  if (action !== "approve" && action !== "discard") return NextResponse.json({ error: "操作の指定が正しくありません。" }, { status: 400 });

  try {
    const client = await hermesClient();
    if (action === "discard") {
      await client.discardMemory(id);
      return NextResponse.json({ ok: true });
    }

    const memory = (await client.pendingMemories()).find((item) => item.id === id);
    if (!memory) return NextResponse.json({ error: "この記憶の案は見つかりません（すでに処理された可能性があります）。" }, { status: 404 });

    const issues = validatePendingMemory(memory);
    if (hasBlockingMemoryIssue(issues)) {
      return NextResponse.json({ error: "形式の確認に通らないため承認できません。却下して、言い直してください。", issues }, { status: 422 });
    }
    if (detectSensitive(memoryReviewText(memory)).length > 0 && body?.confirmed !== true) {
      return NextResponse.json({ error: "個人情報らしき文字列が含まれていないか確認し、チェックを入れてください。" }, { status: 422 });
    }
    await client.approveMemory(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const kind = error instanceof HermesError ? error.kind : "unreachable";
    console.warn(`[hermes] 記憶の${action === "approve" ? "承認" : "却下"}に失敗（${kind}）`, error instanceof Error ? error.message : String(error));
    const failure = describeHermesError(kind);
    return NextResponse.json({ error: failure.message, kind: failure.kind }, { status: failure.status });
  }
}
