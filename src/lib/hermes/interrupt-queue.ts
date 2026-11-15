/**
 * 「止める」「新しい会話」で送ったinterruptが届かなかったとき（回線の一時断など）に、旧ターンが続かないよう
 * ターンIDを控えて再送する（#1005）。サーバーは画面の接続が切れてもターンを続けるので、interruptが届くまでは止まらない。
 *
 * - 控えは `sessionStorage`（同じタブの再読み込み・画面遷移を越える）。使えなければメモリだけ
 * - 「止まった」とみなすのは、interruptが成功したとき、またはサーバーがそのターンを知らないとき（404。終了・期限切れ・再起動）
 * - 持ち主の照合はサーバー（`interrupt` ルート）が行う。ここはidを控えるだけ
 */

const KEY = "morrow-hermes-pending-interrupts";
const MAX_PENDING = 20;
const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;

export type InterruptStorage = Pick<Storage, "getItem" | "setItem">;
export type InterruptOutcome = "done" | "retry";

const memory = new Set<string>();

function read(storage: InterruptStorage | null): string[] {
  const ids = new Set(memory);
  try {
    const raw = storage?.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) for (const id of parsed) if (typeof id === "string" && ID_PATTERN.test(id)) ids.add(id);
  } catch {
    // 読めなければメモリだけ
  }
  return [...ids].slice(-MAX_PENDING);
}

function write(storage: InterruptStorage | null, ids: string[]): void {
  memory.clear();
  for (const id of ids) memory.add(id);
  try {
    storage?.setItem(KEY, JSON.stringify(ids));
  } catch {
    // 書けなければメモリだけ
  }
}

export function addPendingInterrupt(storage: InterruptStorage | null, turnId: string): void {
  if (!ID_PATTERN.test(turnId)) return;
  const ids = read(storage).filter((id) => id !== turnId);
  write(storage, [...ids, turnId].slice(-MAX_PENDING));
}

export function removePendingInterrupt(storage: InterruptStorage | null, turnId: string): void {
  write(
    storage,
    read(storage).filter((id) => id !== turnId),
  );
}

export function listPendingInterrupts(storage: InterruptStorage | null): string[] {
  return read(storage);
}

/** interruptの応答から、控えを消してよいかを決める。成功と「そのターンは無い（404）」は消す。それ以外は再送する。 */
export function interruptOutcome(status: number | null): InterruptOutcome {
  return status !== null && ((status >= 200 && status < 300) || status === 404) ? "done" : "retry";
}

/** 控えている全ターンへinterruptを送り、止まったものを控えから消す。残りがあるかを返す。 */
export async function flushInterrupts(storage: InterruptStorage | null, send: (turnId: string) => Promise<number | null>): Promise<boolean> {
  for (const turnId of listPendingInterrupts(storage)) {
    let status: number | null = null;
    try {
      status = await send(turnId);
    } catch {
      status = null;
    }
    if (interruptOutcome(status) === "done") removePendingInterrupt(storage, turnId);
  }
  return listPendingInterrupts(storage).length > 0;
}

/** 再送の間隔（ミリ秒）。使い切ったら、回線の復帰・画面の復帰・次に開いたときまで待つ。 */
export const INTERRUPT_RETRY_DELAYS = [2000, 5000, 10000, 30000, 60000];

/** 実際の送信（ブラウザ）。通信失敗はnull。 */
export async function sendInterrupt(turnId: string): Promise<number | null> {
  try {
    const response = await fetch(`/api/hermes/turns/${encodeURIComponent(turnId)}/interrupt`, { method: "POST" });
    return response.status;
  } catch {
    return null;
  }
}

let flushing = false;

/**
 * 控えを送りきるまで間隔をあけて再送する（画面のコンポーネントが消えても、ページが生きている間は続く）。
 * すでに走っていれば何もしない。
 */
export function startInterruptFlush(storage: InterruptStorage | null): void {
  if (flushing) return;
  flushing = true;
  void (async () => {
    try {
      for (let attempt = 0; ; attempt += 1) {
        if (!(await flushInterrupts(storage, sendInterrupt))) return;
        const delay = INTERRUPT_RETRY_DELAYS[attempt];
        if (delay === undefined) return;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    } finally {
      flushing = false;
    }
  })();
}
