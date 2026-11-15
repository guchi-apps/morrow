/**
 * 前回の会話の取り直し（#929・#976）の再試行。純粋。
 * 通信の揺れ・ブリッジの一時失敗だけ数回やり直す（許可リスト）。会話が無い・指定不正・設定や認可の問題・セッション切れ（401）は
 * 待っても直らないので、再試行せず従来どおりすぐ知らせる。
 */
const RETRYABLE_KINDS: ReadonlySet<string> = new Set(["unreachable", "hermes_down", "server_error"]);

export const RESTORE_RETRY_DELAYS_MS: readonly number[] = [1000, 3000, 6000];

/** 取得に失敗した応答（`kind`。通信自体の失敗＝fetchの例外は null。kindの無い5xxは `server_error`）が、再試行に値するか。 */
export function shouldRetryRestore(kind: string | null | undefined): boolean {
  return kind === null || (kind !== undefined && RETRYABLE_KINDS.has(kind));
}

/** `attempt`（0始まり。いま失敗した回）の次の待ち時間。尽きたら null。 */
export function nextRestoreDelay(attempt: number): number | null {
  return RESTORE_RETRY_DELAYS_MS[attempt] ?? null;
}
