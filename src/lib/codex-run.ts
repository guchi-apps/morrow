import { runCodexExec, throwIfCodexFailed, type CodexMcpServer, type CodexResult } from "@/lib/codex";
import { recordApiUsage } from "@/lib/usage";
import type { UsageFeature } from "@/lib/usage-feature";

/**
 * `runCodexExec()` の結果を `ApiUsage` へ残す（#133・#229）。**サーバー専用。**
 *
 * **`usage` がnullの回（中断・起動失敗。`turn.completed` が届いていない）は何も残さない。**
 * 下の `runCodexRecorded()` も、使った量を残すのはここ1か所に通す
 * ——新しい経路を足すたびに記録を書き忘れる、をここで塞ぐ。
 */
export async function recordCodexUsage(params: {
  result: CodexResult;
  userId: string;
  feature: UsageFeature;
  model: string;
}): Promise<void> {
  const { result, userId, feature, model } = params;
  if (!result.usage) return;

  await recordApiUsage({ userId, feature, model, usage: result.usage });
}

/**
 * Codexを1回呼び、使った量を残し、打ち切り・失敗を例外にして返す（#229）。
 *
 * **利用者からの割り込みが無い経路の共通の流れ**——朝の見通し（`briefing.ts`）・先回りの提案
 * （`proactive.ts`）・お知らせの選定（`notices.ts`）・話題の仕入れ（`topics.ts`）。以前は
 * 各所が同じ「使用量を記録 → 打ち切り → エラー」を手で書いていた。
 *
 * - **使用量は失敗より先に残す。** 失敗した回でも `turn.completed` が届いていれば量は使い終わって
 *   いる（読めない形で返ってきた回・エラーで終わった回）
 * - 失敗は投げる。**呼び出し元がどう扱うか**（ログに残して戻る・`lastRuns` を更新せず戻る・
 *   その日の記録を残さない・利用者へ返す）は、経路ごとに違うのでそちらで決める
 * - 上限は `timeoutMs` から `AbortSignal.timeout()` を作って渡す。渡すプロンプトの文面には触れない
 *   （1文字でも変わるとCodexのキャッシュが一度外れる）
 */
export async function runCodexRecorded(params: {
  userId: string;
  feature: UsageFeature;
  /** 失敗の文言の主語（「朝の見通しの生成」など）。 */
  label: string;
  model: string;
  prompt: string;
  timeoutMs: number;
  search?: boolean;
  mcpServers?: CodexMcpServer[];
}): Promise<CodexResult> {
  const { userId, feature, label, model, prompt, timeoutMs, search, mcpServers } = params;

  const result = await runCodexExec({
    model,
    prompt,
    signal: AbortSignal.timeout(timeoutMs),
    search,
    mcpServers,
  });

  await recordCodexUsage({ result, userId, feature, model });
  throwIfCodexFailed(result, label, timeoutMs);

  return result;
}
