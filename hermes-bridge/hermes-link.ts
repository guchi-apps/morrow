/**
 * Hermes（`hermes -p morrow serve --isolated`）のWebSocket（`/api/ws`・JSON-RPC 2.0）への接続（#737）。
 *
 * Node標準の `WebSocket` だけを使う（依存は足さない）。ターンごとに1接続を張り、終わったら閉じる。
 * テストでは `HermesLink` を差し替える（`turn.ts` はこのインターフェースだけに依存する）。
 */

export interface HermesEvent {
  type: string;
  sessionId: string;
  payload: Record<string, unknown>;
}

/** サーバーからの要求（`approval`・`clarify` など。`id` が文字列で `method` を持つフレーム）。 */
export interface HermesServerRequest {
  id: string;
  method: string;
  sessionId: string;
  params: Record<string, unknown>;
}

export class HermesRpcError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

export interface HermesLink {
  rpc(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** サーバーの要求に答える（`result`）か、拒む（`error`）。 */
  reply(id: string, outcome: { result: unknown } | { error: { code: number; message: string } }): void;
  onEvent(handler: (event: HermesEvent) => void): void;
  onServerRequest(handler: (request: HermesServerRequest) => void): void;
  /** 接続が切れたとき（こちらから閉じた場合を除く）。 */
  onClose(handler: () => void): void;
  close(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Hermesへ繋ぎ、`gateway.ready` を待ってから返す。`timeoutMs` 内に繋がらなければ投げる。 */
export function connectHermes(options: { url: string; token: string; timeoutMs: number }): Promise<HermesLink> {
  return new Promise((resolve, reject) => {
    const endpoint = new URL("/api/ws", options.url);
    endpoint.searchParams.set("token", options.token);
    const socket = new WebSocket(endpoint);

    let ready = false;
    let closedByUs = false;
    let nextId = 1;
    const pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
    let eventHandler: (event: HermesEvent) => void = () => {};
    let requestHandler: (request: HermesServerRequest) => void = () => {};
    let closeHandler: () => void = () => {};

    const timer = setTimeout(() => fail(new Error("Hermesへの接続がタイムアウトした")), options.timeoutMs);

    function fail(error: Error) {
      clearTimeout(timer);
      closedByUs = true;
      try {
        socket.close();
      } catch {
        // 既に閉じている
      }
      reject(error);
    }

    const link: HermesLink = {
      rpc(method, params) {
        return new Promise((resolveRpc, rejectRpc) => {
          if (socket.readyState !== WebSocket.OPEN) {
            rejectRpc(new Error("Hermesとの接続が閉じている"));
            return;
          }
          const id = nextId++;
          pending.set(id, { resolve: resolveRpc, reject: rejectRpc });
          socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
        });
      },
      reply(id, outcome) {
        if (socket.readyState !== WebSocket.OPEN) return;
        socket.send(JSON.stringify({ jsonrpc: "2.0", id, ...outcome }));
      },
      onEvent(handler) {
        eventHandler = handler;
      },
      onServerRequest(handler) {
        requestHandler = handler;
      },
      onClose(handler) {
        closeHandler = handler;
      },
      close() {
        closedByUs = true;
        try {
          socket.close();
        } catch {
          // 既に閉じている
        }
      },
    };

    socket.addEventListener("message", (message) => {
      let frame: unknown;
      try {
        frame = JSON.parse(String(message.data));
      } catch {
        return;
      }
      if (!isRecord(frame)) return;

      // 応答（数値のid）
      if (typeof frame.id === "number" && ("result" in frame || "error" in frame)) {
        const waiter = pending.get(frame.id);
        if (!waiter) return;
        pending.delete(frame.id);
        if (isRecord(frame.error)) {
          waiter.reject(new HermesRpcError(Number(frame.error.code ?? 0), String(frame.error.message ?? "Hermesのエラー")));
        } else {
          waiter.resolve(isRecord(frame.result) ? frame.result : {});
        }
        return;
      }

      const params = isRecord(frame.params) ? frame.params : {};
      const sessionId = typeof params.session_id === "string" ? params.session_id : "";

      // 通知（event）
      if (frame.method === "event") {
        const type = typeof params.type === "string" ? params.type : "";
        if (type === "gateway.ready" && !ready) {
          ready = true;
          clearTimeout(timer);
          resolve(link);
          return;
        }
        eventHandler({ type, sessionId, payload: isRecord(params.payload) ? params.payload : {} });
        return;
      }

      // サーバーからの要求（idが文字列でmethodを持つ）
      if (typeof frame.id === "string" && typeof frame.method === "string") {
        requestHandler({ id: frame.id, method: frame.method, sessionId, params });
      }
    });

    socket.addEventListener("error", () => {
      if (!ready) fail(new Error("Hermesへ接続できない"));
    });

    socket.addEventListener("close", () => {
      for (const waiter of pending.values()) waiter.reject(new Error("Hermesとの接続が閉じた"));
      pending.clear();
      if (!ready) {
        fail(new Error("Hermesとの接続が準備前に閉じた"));
        return;
      }
      if (!closedByUs) closeHandler();
    });
  });
}
