import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { hermesClient } from "@/lib/hermes/client";
import { HermesError } from "@/lib/hermes/client-core";
import { describeHermesError } from "@/lib/hermes/errors";
import { MEMORY_ENTRY_MAX, type MemoryTarget } from "@/lib/hermes/memory-core";
import { readJsonObject } from "@/lib/json-body";

/**
 * 保存済みの記憶1項目の削除（#1155）。`DELETE { target: "user" | "memory", text }`。
 * 全文が一致した項目だけが消える（画面を開いた後に変わっていれば404）。反映は新しい会話から（Hermesは会話の開始時に記憶を読み込む）。
 */

export const dynamic = "force-dynamic";

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const body = await readJsonObject(request);
  const target = body?.target;
  const text = body?.text;
  if ((target !== "user" && target !== "memory") || typeof text !== "string" || text.trim() === "" || text.length > MEMORY_ENTRY_MAX * 4) {
    return NextResponse.json({ error: "削除する記憶の指定が正しくありません。" }, { status: 400 });
  }

  try {
    await (await hermesClient()).deleteMemoryEntry(target as MemoryTarget, text);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const kind = error instanceof HermesError ? error.kind : "unreachable";
    console.warn(`[hermes] 記憶の削除に失敗（${kind}）`, error instanceof Error ? error.message : String(error));
    const failure = describeHermesError(kind);
    return NextResponse.json({ error: failure.message, kind: failure.kind }, { status: failure.status });
  }
}
