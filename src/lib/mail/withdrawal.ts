import { callCardWithdrawalWriteToolJson, callToolJson, connectedServerFor, McpCallError } from "@/lib/mcp/direct-call";

import {
  cardConfirmArgs,
  evaluateCardWithdrawal,
  evaluateWithdrawal,
  parseBalances,
  parseCardWithdrawals,
  withPickedAccount,
  type BalanceAccount,
  type BalanceCheck,
  type CardCheck,
  type CardWithdrawalItem,
  type Withdrawal,
} from "@/lib/mail/withdrawal-core";

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

/** 今後の引き落とし予定を読む日数（Asset Managerの上限）。 */
const CARD_HORIZON_DAYS = 62;

async function loadCardItems(userId: string): Promise<CardWithdrawalItem[] | null> {
  try {
    const server = await connectedServerFor(userId, "aide");
    if (server) return parseCardWithdrawals(await callToolJson(server, "asset_manager_card_withdrawals", { days: CARD_HORIZON_DAYS }));
  } catch (error) {
    console.error("[aide-bot] カード引き落とし見込みの取得に失敗した", error instanceof Error ? error.message : error);
  }
  return null;
}

/**
 * メールの確定額とAsset Managerのカード引き落とし見込みの突き合わせ（#910）。読み取りだけ・保存しない。
 * 引き落とし日が読めていない・同じ日の予定に当たらない・決められないときはnull。取得できなかった回は `unknown`（「一致」と混ぜない。#214）。
 */
export async function checkCardWithdrawal(userId: string, withdrawal: Withdrawal, messageId: string): Promise<CardCheck | null> {
  if (!withdrawal.date) return null;
  return evaluateCardWithdrawal(withdrawal, await loadCardItems(userId), messageId);
}

export type CardConfirmOutcome =
  | { ok: true; result: "replaced" | "unchanged" | "created"; previousAmount: number | null; card: CardCheck }
  | { ok: false; message: string };

/**
 * メールの確定額で見込みを上書きする（#910）。**承認後にサーバーが値を決め直す**（画面から額・カードは受け取らない）:
 * 額・日はメールの分析（サーバーの記憶）、カードは見込みの読み直しで1件に決まったものだけ。食い違っていなければ書かない。
 * 冪等キーは `cardConfirmSourceKey()`（メールごと）。呼び出し側が先にメールの持ち主を照合する。
 */
export async function confirmCardWithdrawal(userId: string, withdrawal: Withdrawal, messageId: string): Promise<CardConfirmOutcome> {
  if (!withdrawal.date) return { ok: false, message: "メールに引き落とし日が無いため、登録できません。" };
  const server = await connectedServerFor(userId, "aide");
  if (!server) return { ok: false, message: "AIDEが接続されていません。設定の接続から繋いでください。" };
  const check = evaluateCardWithdrawal(withdrawal, await loadCardItems(userId), messageId);
  if (!check || check.status === "unknown") return { ok: false, message: "Asset Managerの見込みを確かめられなかったため、登録しませんでした。" };
  if (check.status !== "mismatch") return { ok: false, message: check.status === "confirmed" ? "このメールの額はすでに登録されています。" : "見込みはすでにメールの額と一致しています。" };
  try {
    const json = await callCardWithdrawalWriteToolJson(server, "asset_manager_confirm_card_withdrawal", cardConfirmArgs(check, messageId));
    const result = json.result === "unchanged" || json.result === "created" ? json.result : "replaced";
    const previous = typeof json.previousAmountJpy === "number" ? json.previousAmountJpy : null;
    return { ok: true, result, previousAmount: previous, card: { status: "confirmed", cardName: check.cardName, paymentDate: check.paymentDate, amount: check.mailAmount } };
  } catch (error) {
    console.error("[aide-bot] カード引き落とし見込みの上書きに失敗した", error instanceof Error ? error.message : error);
    const reason = error instanceof McpCallError && error.reason ? `（${error.reason}）` : "";
    return { ok: false, message: `登録できませんでした${reason}。時間をおいて試してください。` };
  }
}
