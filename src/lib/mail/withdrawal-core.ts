import type { TaskFields } from "@/lib/mail/suggest-core";
import { flattenText } from "@/lib/mail/triage-core";

/**
 * 口座引き落としのお知らせメールの残高確認（#842）のうち、DB・ネットワークに触れない部分。`test/mail-withdrawal.test.ts` が固定する。
 *
 * メールのAI分析（#766）が本文から引き落とし額・日・口座名を読み取り（`withdrawal`）、AIDEの `aide_balances`（Zaim連携の残高）と突き合わせる。
 * **足りると言い切れないときは `unknown` に倒す**（残高が古い・最終更新が分からない・口座が特定できない・取得できない）。
 * 残高・金額はMorrowのDB・ログに残さない（#732）。残高は引き落とし日までの他の引き落とし・入金を含まない。
 */

export type Withdrawal = { amount: number; date: string | null; account: string | null; payee: string | null };

/** 残高の最終更新がこれより古ければ判定しない。 */
export const BALANCE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const AMOUNT_MAX = 1_000_000_000;
const NAME_LIMIT = 40;

export const WITHDRAWAL_RULES: readonly string[] = [
  "withdrawal は、銀行口座からの引き落とし（クレジットカード代金・公共料金・保険料・ローン・サブスクなど）の事前のお知らせメールのときだけ入れる。それ以外のメールでは null",
  "withdrawal.amount は引き落とされる金額（円の整数）。本文に無い・分からないときは withdrawal ごと null",
  "withdrawal.date は引き落とし日（YYYY-MM-DD）。本文に無ければ null",
  "withdrawal.account は引き落とし先の銀行口座名（「三井住友銀行」など。本文にあるときだけ。カード名・請求元の名前は入れない）。無ければ null",
  "withdrawal.payee は請求元（カード会社・事業者名）。無ければ null",
];

export const WITHDRAWAL_EXAMPLE = { withdrawal: { amount: 84320, date: "2026-11-27", account: "三井住友銀行", payee: "◯◯カード" } };

function validDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? null : value;
}

function name(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const flat = flattenText(value, NAME_LIMIT);
  return flat === "" ? null : flat;
}

/** 外から来た値（Codexの返答・キャッシュ）を検証する。額が読めなければnull（推測で埋めない）。 */
export function normalizeWithdrawal(raw: unknown): Withdrawal | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const { amount, date, account, payee } = raw as Record<string, unknown>;
  const n = typeof amount === "string" ? Number(amount.replace(/[,，円\s]/g, "")) : amount;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0 || n > AMOUNT_MAX) return null;
  return { amount: Math.round(n), date: validDate(date), account: name(account), payee: name(payee) };
}

/** 分析の返答から `withdrawal` を読む。無い・壊れていればnull（分析全体は落とさない）。 */
export function parseWithdrawalReply(answer: string): Withdrawal | null {
  const start = answer.indexOf("{");
  const end = answer.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const raw = JSON.parse(answer.slice(start, end + 1)) as unknown;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    return normalizeWithdrawal((raw as Record<string, unknown>).withdrawal);
  } catch {
    return null;
  }
}

export type BalanceAccount = { name: string; amount: number; lastUpdatedAt: string | null };

/** `aide_balances` の応答から口座一覧を読む。`empty: true`（一度も巡回していない）・形が違うときはnull。 */
export function parseBalances(json: Record<string, unknown>): BalanceAccount[] | null {
  if (json.empty === true || !Array.isArray(json.balances)) return null;
  const accounts: BalanceAccount[] = [];
  for (const item of json.balances) {
    if (typeof item !== "object" || item === null) continue;
    const { name: n, amount, lastUpdatedAt } = item as Record<string, unknown>;
    if (typeof n !== "string" || typeof amount !== "number" || !Number.isFinite(amount)) continue;
    accounts.push({ name: n, amount, lastUpdatedAt: typeof lastUpdatedAt === "string" ? lastUpdatedAt : null });
  }
  return accounts;
}

function normalizeName(value: string): string {
  return value.normalize("NFKC").replace(/[\s　]/g, "").toLowerCase();
}

/** 口座名の手掛かりに合う口座。ちょうど1件のときだけ返す（複数・0件は推測で選ばない）。 */
export function matchAccount(accounts: readonly BalanceAccount[], hint: string): { account: BalanceAccount } | { candidates: string[] } {
  const h = normalizeName(hint);
  if (h.length < 2) return { candidates: [] };
  const hits = accounts.filter((a) => {
    const n = normalizeName(a.name);
    return n.length >= 2 && (n.includes(h) || h.includes(n));
  });
  if (hits.length === 1) return { account: hits[0] };
  return { candidates: hits.map((a) => a.name) };
}

export type BalanceKnown = { status: "enough" | "short"; amount: number; date: string | null; payee: string | null; account: string; balance: number; after: number; shortBy: number; asOf: string };
export type BalanceCheck =
  | BalanceKnown
  | { status: "unknown"; amount: number; date: string | null; payee: string | null; account: string | null; reason: string; choices?: string[] };

/** 引き落とし額と残高を突き合わせる。`accounts` がnullなら取得できなかった（または未巡回）。 */
export function evaluateWithdrawal(w: Withdrawal, accounts: readonly BalanceAccount[] | null, now: Date): BalanceCheck {
  const base = { amount: w.amount, date: w.date, payee: w.payee };
  // 口座を決められない理由のときだけ、残高の一覧から選べるよう口座名を添える（#909）
  const choices = accounts && accounts.length > 0 ? accounts.map((a) => a.name) : undefined;
  const unknown = (reason: string, account: string | null = w.account, pick = false): BalanceCheck => ({ status: "unknown", ...base, account, reason, ...(pick && choices ? { choices } : {}) });
  if (!accounts) return unknown("残高を取得できませんでした。AIDEとの接続を確かめてください。");
  if (!w.account) return unknown("メールに引き落とし口座の名前が見当たりませんでした。口座を選ぶと残高を確認できます。", null, true);
  const matched = matchAccount(accounts, w.account);
  if (!("account" in matched)) {
    return unknown(
      matched.candidates.length === 0
        ? `「${w.account}」に合う口座が残高の一覧にありません。`
        : `「${w.account}」に合う口座が複数あり、決められません（${matched.candidates.join("・")}）。`,
      w.account,
      true,
    );
  }
  const { account } = matched;
  if (!account.lastUpdatedAt) return unknown(`「${account.name}」は残高の最終更新が分からないため、判定しません。`, account.name);
  const updated = Date.parse(account.lastUpdatedAt);
  if (Number.isNaN(updated)) return unknown(`「${account.name}」の最終更新を読めませんでした。`, account.name);
  if (now.getTime() - updated > BALANCE_MAX_AGE_MS) {
    return unknown(`「${account.name}」の残高が古い（${account.lastUpdatedAt.slice(0, 16).replace("T", " ")}時点）ため、判定しません。Zaimの連携を更新してください。`, account.name);
  }
  const after = account.amount - w.amount;
  return {
    status: after >= 0 ? "enough" : "short",
    ...base,
    account: account.name,
    balance: account.amount,
    after,
    shortBy: Math.max(0, -after),
    asOf: account.lastUpdatedAt,
  };
}

/**
 * 利用者が選んだ口座名を引き落としの口座として使う（#909）。選べるのは残高の一覧にある名前だけで、
 * 一覧に無い値（外から来た値）は無視してメールの読み取りのままにする。
 */
export function withPickedAccount(w: Withdrawal, accounts: readonly BalanceAccount[] | null, picked: unknown): Withdrawal {
  if (typeof picked !== "string" || !accounts?.some((a) => a.name === picked)) return w;
  return { ...w, account: picked };
}

/** 不足のときに「タスクにする」へ渡す値。期限は引き落とし日の前日（日付が無ければ無し）。 */
export function shortageTask(check: BalanceKnown): TaskFields {
  const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;
  let due: string | null = null;
  if (check.date) {
    const d = new Date(`${check.date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    due = d.toISOString().slice(0, 10);
  }
  const who = check.payee ?? "引き落とし";
  return {
    title: `${check.account}へ${yen(check.shortBy)}入金する（${who}の引き落とし）`,
    due,
    dueTime: null,
    planned: null,
    plannedTime: null,
    memo: `${check.date ?? "日付不明"}に${yen(check.amount)}が引き落とされる予定。${check.asOf.slice(0, 16).replace("T", " ")}時点の残高は${yen(check.balance)}で、${yen(check.shortBy)}足りない。`,
  };
}
