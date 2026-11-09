/**
 * メール分析の取り直しの判定（#840。純粋・クライアントからもimportする）。
 *
 * 分析はサーバーで走り続け、結果は30分残る。画面の通信だけが途切れた回（iOSで別アプリへ移った等）は
 * 取り直せば走っている1回か保存済みの結果を拾えるので、エラーにしない。
 */

/** 取り直すまでの待ち（ミリ秒）と、取り直しの上限（分析は最長150秒なので、それを越えて待てる回数）。 */
export const ANALYZE_RETRY_MS = 5000;
export const ANALYZE_RETRY_MAX = 36;

/**
 * 取り直すか。429（別の分析・指示が走っている）と通信失敗（`"network"`）だけ取り直し、
 * 持ち主違い・404・分析失敗（502）などの確定した答えは取り直さない。
 */
export function shouldRetryAnalysis(status: number | "network", attempt: number): boolean {
  if (attempt >= ANALYZE_RETRY_MAX) return false;
  return status === 429 || status === "network";
}
