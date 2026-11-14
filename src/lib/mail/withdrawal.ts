import { connectedServerFor, callToolJson } from "@/lib/mcp/direct-call";

import { evaluateWithdrawal, parseBalances, withPickedAccount, type BalanceAccount, type BalanceCheck, type Withdrawal } from "@/lib/mail/withdrawal-core";

/**
 * 引き落とし前の残高確認（#842）。**サーバー専用。** AIDEの `aide_balances`（読み取りだけ）を毎回引いて判定する。
 * 結果は保存もキャッシュもしない（残高が古い判定を30分の分析の記憶に閉じ込めないため。レビュー指摘）。
 * 取得できなかった回は例外にせず `unknown` で返す（「足りる」と混ぜない。#214）。
 */
export async function checkWithdrawal(userId: string, withdrawal: Withdrawal, now = new Date(), pickedAccount?: string): Promise<BalanceCheck> {
  let accounts: BalanceAccount[] | null = null;
  try {
    const server = await connectedServerFor(userId, "aide");
    if (server) accounts = parseBalances(await callToolJson(server, "aide_balances"));
  } catch (error) {
    console.error("[aide-bot] 残高の取得に失敗した", error instanceof Error ? error.message : error);
  }
  return evaluateWithdrawal(withPickedAccount(withdrawal, accounts, pickedAccount), accounts, now);
}
