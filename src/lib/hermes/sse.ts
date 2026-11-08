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

/** 種類を絞って1ブロックを読む。ブラウザ向けの中継（#794。`proposal` を足した種類）も同じ読み方をする。 */
export function parseSseBlockOf<T extends { type: string }>(block: string, known: ReadonlySet<string>): T | null {
  let type = "";
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line === "" || line.startsWith(":")) continue;
    if (line.startsWith("event:")) type = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  if (!known.has(type) || dataLines.length === 0) return null;
  try {
    const data: unknown = JSON.parse(dataLines.join("\n"));
    if (typeof data !== "object" || data === null) return null;
    return { type, data } as unknown as T;
  } catch {
    return null;
  }
}

export function parseSseBlock(block: string): BridgeEvent | null {
  return parseSseBlockOf<BridgeEvent>(block, KNOWN_TYPES);
}

/** バイト列のストリームを、空行で区切ったブロックごとに `BridgeEvent` へ読み替える。 */
export function readBridgeEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<BridgeEvent> {
  return readSseEvents<BridgeEvent>(body, KNOWN_TYPES);
}

export async function* readSseEvents<T extends { type: string }>(
  body: ReadableStream<Uint8Array>,
  known: ReadonlySet<string>,
): AsyncGenerator<T> {
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
        const event = parseSseBlockOf<T>(block, known);
        if (event) yield event;
      }
    }
    const rest = parseSseBlockOf<T>(buffer, known);
    if (rest) yield rest;
  } finally {
    reader.releaseLock();
  }
}
