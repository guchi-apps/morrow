import type { RelayEvent } from "./stream-view.ts";
import type { TurnLog } from "./turn-pump.ts";

const HEARTBEAT_MS = 15_000;

export function sse(event: RelayEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

/** 溜め（{@link TurnLog}）の `after` 番目より後を、SSEとして流す。購読をやめても（接続が切れても）ターンは止めない。 */
export function streamOf(log: TurnLog<RelayEvent>, after: number): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const stop = () => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    unsubscribe?.();
    unsubscribe = null;
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          stop();
        }
      };
      // Apacheなどのプロキシに切られないように、こちらからもコメント行を流す
      heartbeat = setInterval(() => write(": ping\n\n"), HEARTBEAT_MS);
      unsubscribe = log.subscribe(
        after,
        (event) => write(sse(event)),
        () => {
          stop();
          try {
            controller.close();
          } catch {
            // すでに閉じている
          }
        },
      );
    },
    cancel() {
      stop();
    },
  });
}

