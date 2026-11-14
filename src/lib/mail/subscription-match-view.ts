import type { RegisteredSubscription } from "@/lib/mail/subscription-match-core";

/** 登録済みのサブスクの表示用の整形（#884）。クライアントからもimportする純粋な関数。 */

export function registeredAmount(r: RegisteredSubscription): string | null {
  if (r.amount === null) return null;
  return `${r.amount.toLocaleString("ja-JP")}${r.currency === "USD" ? "ドル" : "円"}`;
}

const cycleLabel = (r: RegisteredSubscription) => (r.billingCycle === "YEARLY" ? "毎年" : r.billingCycle === "MONTHLY" ? "毎月" : null);

const day = (value: string) => value.replaceAll("-", "/");

/** 提案の行に出す1行（「JAF・4,000円・毎年・次回 12/1」）。 */
export function registeredSummary(r: RegisteredSubscription): string {
  const next = r.nextBillingDay ? `次回 ${Number(r.nextBillingDay.slice(5, 7))}/${Number(r.nextBillingDay.slice(8, 10))}` : null;
  return [r.name, registeredAmount(r), cycleLabel(r), next].filter((p): p is string => Boolean(p)).join("・");
}

/** 詳細（ハーフモーダル）の項目。値の無い項目は出さない。 */
export function registeredDetails(r: RegisteredSubscription): { label: string; value: string }[] {
  const rows: { label: string; value: string | null }[] = [
    { label: "1回あたりの金額", value: registeredAmount(r) },
    { label: "請求サイクル", value: r.billing ?? cycleLabel(r) },
    { label: "次回請求日", value: r.nextBillingDay ? `${day(r.nextBillingDay)}${r.daysUntilNextBilling !== null ? `（${r.daysUntilNextBilling === 0 ? "今日" : `あと${r.daysUntilNextBilling}日`}）` : ""}` : null },
    { label: "支払方法", value: r.paymentMethod },
    { label: "契約開始日", value: r.startDate ? day(r.startDate) : null },
    { label: "ラベル", value: r.labels.length > 0 ? r.labels.join("、") : null },
  ];
  return rows.filter((row): row is { label: string; value: string } => row.value !== null);
}
