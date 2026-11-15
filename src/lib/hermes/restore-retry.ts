/**
 * 前回の会話の取り直し（#929・#976）の再試行。純粋。
 * 通信の揺れ・ブリッジの一時失敗は待てば直るので数回やり直す。会話が無い・指定が正しくないは待っても変わらないので再試行しない。
 */

export const RESTORE_RETRY_DELAYS_MS: readonly number[] = [1000, 3000, 6000];

/** 取得に失敗した応答（`kind`。通信自体の失敗は null）が、再試行に値するか。 */
export function shouldRetryRestore(kind: string | null | undefined): boolean {
  return kind !== "no_session" && kind !== "invalid";
}

/** `attempt`（0始まり。いま失敗した回）の次の待ち時間。尽きたら null。 */
export function nextRestoreDelay(attempt: number): number | null {
  return RESTORE_RETRY_DELAYS_MS[attempt] ?? null;
}
