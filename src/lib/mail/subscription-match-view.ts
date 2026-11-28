import { itemsTotal } from "@/lib/mail/payment-receipt";
import type { RegisteredSubscription } from "@/lib/mail/subscription-match-core";
import type { Suggestion } from "@/lib/mail/suggest-core";

/**
 * 登録済みの定期払いの表示用の整形（#884）。クライアントからもimportする純粋な関数。
 * 照合できても、今回の請求が支払い済み・記録済みとは限らない。金額と日付は定期払いの登録内容だと読める名前にする（#1201）。
 */

const money = (amount: number, currency: RegisteredSubscription["currency"]) => `${amount.toLocaleString("ja-JP")}${currency === "USD" ? "ドル" : "円"}`;

/** 金額が毎回変わる契約の `amount` は見込み額なので「約」を付ける（#1221）。 */
export function registeredAmount(r: RegisteredSubscription): string | null {
  if (r.amount === null) return null;
  return `${r.variableAmount ? "約" : ""}${money(r.amount, r.currency)}`;
}

/**
 * 今回の請求額が定期払いの登録額と違うときの、請求額の表示（「6,234円」「12ドル」）。同じ・比べられない（金額が無い・
 * 通貨が違う）ならnull。外貨建ての支払いの円換算額は、円の登録額と比べない。金額が毎回変わる契約は比べない（#1221）。
 */
export function differingInvoiceAmount(card: Suggestion, r: RegisteredSubscription): string | null {
  if (r.variableAmount || r.amount === null || r.currency === null) return null;
  let amount: number | null = null;
  let currency: string | null = null;
  if (card.kind === "subscription") {
    amount = card.fields.amount;
    currency = card.fields.currency;
  } else if (card.kind === "payment") {
    const f = card.fields;
    const original = f.originalCurrency?.toUpperCase() ?? "JPY";
    amount = original === "JPY" ? (f.amount ?? itemsTotal(f.items)) : f.originalAmount;
    currency = original;
  }
  if (amount === null || currency !== r.currency || amount === r.amount) return null;
  return money(amount, r.currency);
}

const cycleLabel = (r: RegisteredSubscription) => (r.billingCycle === "YEARLY" ? "毎年" : r.billingCycle === "MONTHLY" ? "毎月" : null);

const day = (value: string) => value.replaceAll("-", "/");

/** 提案の行に出す1行（「JAF・登録額 4,000円・毎年・次回予定 12/1」）。 */
export function registeredSummary(r: RegisteredSubscription): string {
  const next = r.nextBillingDay ? `次回予定 ${Number(r.nextBillingDay.slice(5, 7))}/${Number(r.nextBillingDay.slice(8, 10))}` : null;
  const amount = registeredAmount(r);
  return [r.name, amount && `${r.variableAmount ? "見込み" : "登録額"} ${amount}`, cycleLabel(r), next].filter((p): p is string => Boolean(p)).join("・");
}

/** 詳細（ハーフモーダル）の項目。値の無い項目は出さない。 */
export function registeredDetails(r: RegisteredSubscription): { label: string; value: string }[] {
  const rows: { label: string; value: string | null }[] = [
    { label: r.variableAmount ? "定期払いの見込み額" : "定期払いの登録額", value: registeredAmount(r) },
    { label: "請求サイクル", value: r.billing ?? cycleLabel(r) },
    { label: "定期払いの次回予定日", value: r.nextBillingDay ? `${day(r.nextBillingDay)}${r.daysUntilNextBilling !== null ? `（${r.daysUntilNextBilling === 0 ? "今日" : `あと${r.daysUntilNextBilling}日`}）` : ""}` : null },
    { label: "支払方法", value: r.paymentMethod },
    { label: "契約開始日", value: r.startDate ? day(r.startDate) : null },
    { label: "ラベル", value: r.labels.length > 0 ? r.labels.join("、") : null },
  ];
  return rows.filter((row): row is { label: string; value: string } => row.value !== null);
}
