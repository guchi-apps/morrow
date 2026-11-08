import type { BridgeEvent, BridgeEventType } from "./contract.ts";

/**
 * ブリッジのSSEを読む（純粋。#737）。
 *
 * `event:` と `data:`（JSON）の組を1イベントとして取り出し、`:` で始まるコメント行（ハートビート）は捨てる。
 * 知らない種類・JSONとして読めないデータは捨てる（ブリッジが新しい種類を足しても古いMorrowが落ちない）。
 */

const KNOWN_TYPES: ReadonlySet<BridgeEventType> = new Set<BridgeEventType>([
  "turn",
  "message.delta",
  "reasoning.delta",
  "tool.start",
  "tool.progress",
  "tool.complete",
  "approval",
  "clarify",
  "message.complete",
  "error",
]);

export function parseSseBlock(block: string): BridgeEvent | null {
  let type = "";
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line === "" || line.startsWith(":")) continue;
    if (line.startsWith("event:")) type = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  if (!KNOWN_TYPES.has(type as BridgeEventType) || dataLines.length === 0) return null;
  try {
    const data: unknown = JSON.parse(dataLines.join("\n"));
    if (typeof data !== "object" || data === null) return null;
    return { type, data } as BridgeEvent;
  } catch {
    return null;
  }
}

/** バイト列のストリームを、空行で区切ったブロックごとに `BridgeEvent` へ読み替える。 */
export async function* readBridgeEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<BridgeEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const block = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const event = parseSseBlock(block);
        if (event) yield event;
      }
    }
    const rest = parseSseBlock(buffer);
    if (rest) yield rest;
  } finally {
    reader.releaseLock();
  }
}
