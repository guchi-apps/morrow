/**
 * ターンのイベントの溜め（#1000。純粋＋プロセス内の置き場）。
 *
 * iOSで別アプリへ移るとブラウザの通信が切られる。以前はそれでブリッジのターンが中断されたが、Morrowのサーバーが
 * ブリッジのストリームをブラウザの接続と無関係に読み切り、イベントをここへ溜める。ブラウザは戻ったとき
 * `GET /api/hermes/turns/<id>/events?after=<受けた数>` で続きから受け直す。
 *
 * プロセス内の記録（PM2で1プロセスという前提。`turn-owners.ts` と同じ）。再起動・期限切れでは続きを返せず、画面は従来の
 * 「途中で止まりました」に落ちる。本文はMorrowのDBに残さない（終了から {@link RETAIN_MS} だけメモリに持つ）。
 */

/** 1ターンに溜めるイベントの上限。超えたら溜めるのをやめる（再購読は `truncated` で断る。生中継は続く）。 */
export const MAX_LOGGED_EVENTS = 5000;
/** ターンが終わってから溜めを持つ時間。 */
export const RETAIN_MS = 10 * 60 * 1000;

export class TurnLog<T> {
  private readonly events: T[] = [];
  private readonly listeners = new Set<(event: T) => void>();
  private readonly doneListeners = new Set<() => void>();
  private ended = false;
  private overflowed = false;

  push(event: T): void {
    if (this.ended) return;
    if (this.events.length < MAX_LOGGED_EVENTS) this.events.push(event);
    else this.overflowed = true;
    for (const listener of [...this.listeners]) listener(event);
  }

  finish(): void {
    if (this.ended) return;
    this.ended = true;
    for (const listener of [...this.doneListeners]) listener();
    this.listeners.clear();
    this.doneListeners.clear();
  }

  get isEnded(): boolean {
    return this.ended;
  }

  /** 溜めきれず取りこぼした（途中からの再購読はできない）。 */
  get truncated(): boolean {
    return this.overflowed;
  }

  get length(): number {
    return this.events.length;
  }

  /** `after` 番目より後の溜めたイベント。 */
  since(after: number): T[] {
    return this.events.slice(Math.max(0, after));
  }

  /**
   * 溜めた続き（`after` より後）を渡し、そのあと終わるまで新しいイベントを渡す。終わっていれば `onDone` をすぐ呼ぶ。
   * 返り値で購読をやめる（ターンは止めない）。
   */
  subscribe(after: number, onEvent: (event: T) => void, onDone: () => void): () => void {
    for (const event of this.since(after)) onEvent(event);
    if (this.ended) {
      onDone();
      return () => {};
    }
    this.listeners.add(onEvent);
    this.doneListeners.add(onDone);
    return () => {
      this.listeners.delete(onEvent);
      this.doneListeners.delete(onDone);
    };
  }
}

type Entry = { userId: string; log: TurnLog<unknown> };
const entries = new Map<string, Entry>();

export function registerTurnLog(turnId: string, userId: string, log: TurnLog<unknown>): void {
  entries.set(turnId, { userId, log });
}

/** 終わったターンの溜めを、一定時間あとに捨てる。 */
export function expireTurnLog(turnId: string, afterMs: number = RETAIN_MS): void {
  const timer = setTimeout(() => entries.delete(turnId), afterMs);
  timer.unref?.();
}

/** 持ち主の溜め。他の利用者のもの・無いものは null。 */
export function turnLogOf<T>(turnId: string, userId: string): TurnLog<T> | null {
  const entry = entries.get(turnId);
  return entry && entry.userId === userId ? (entry.log as TurnLog<T>) : null;
}
