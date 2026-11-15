/**
 * ターンIDを、最初のSSEイベントより前（レスポンスヘッダー）で画面へ渡す（#1005）。
 * 画面はこれで、本文を読み始める前の「止める」・新しい会話・画面離脱でも、interruptと再接続に使うidを持てる。
 */
export const TURN_ID_HEADER = "x-hermes-turn-id";

/** ヘッダーから読む。形が違う値は無いものとして扱う（URLのパスへ入れるので英数字・`-`・`_`・`.`・`:`だけ）。 */
export function readTurnIdHeader(headers: { get(name: string): string | null }): string | null {
  const value = headers.get(TURN_ID_HEADER);
  return value !== null && /^[A-Za-z0-9_.:-]{1,200}$/.test(value) ? value : null;
}
