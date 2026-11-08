/**
 * 同時実行の制限（#737）: 1セッション1ターン、ブリッジ全体で `max` 本。
 * 取れたら解放用の関数を返す。取れなければ理由を返す（HTTPでは 409 / 429 に対応する）。
 */
export class TurnLimiter {
  private readonly sessions = new Set<string>();
  private total = 0;

  private readonly max: number;

  constructor(max: number) {
    this.max = max;
  }

  /** ブリッジ全体の枠を取る。 */
  acquireSlot(): (() => void) | "bridge_busy" {
    if (this.total >= this.max) return "bridge_busy";
    this.total += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.total -= 1;
    };
  }

  /** セッションの枠を取る（続きのセッションだけ。新規は衝突しない）。 */
  acquireSession(sessionId: string): (() => void) | "session_busy" {
    if (this.sessions.has(sessionId)) return "session_busy";
    this.sessions.add(sessionId);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.sessions.delete(sessionId);
    };
  }

  get running(): number {
    return this.total;
  }
}
