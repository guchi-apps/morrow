import { NextResponse } from "next/server";

import { HermesError } from "./client-core.ts";
import { describeHermesError, RATE_LIMITED } from "./errors.ts";

/**
 * AIDEの再接続・再ログイン（#1240）の共通部分。**サーバー専用。**
 *
 * 1本ずつしか走らせない（プロセス内）。`reload.mcp` を重ねるとHermesが同じ張り直しを繰り返し、
 * ログインは同時に1つしか持てない（新しく始めると前の流れを取り消す）ため。
 */

let running = false;

export class AideActionBusyError extends Error {}

export async function runAideAction<T>(run: () => Promise<T>): Promise<T> {
  if (running) throw new AideActionBusyError("AIDEの再接続・再ログインが走っている");
  running = true;
  try {
    return await run();
  } finally {
    running = false;
  }
}

export function aideActionFailure(error: unknown): NextResponse {
  if (error instanceof AideActionBusyError) {
    return NextResponse.json({ error: "いま別の再接続・ログインを実行しています。終わってからもう一度押してください。", kind: RATE_LIMITED.kind }, { status: 429 });
  }
  const failure = describeHermesError(error instanceof HermesError ? error.kind : "unreachable");
  return NextResponse.json({ error: failure.message, kind: failure.kind }, { status: failure.status });
}
