/**
 * メールのサブスク提案と、Asset Managerに登録済みのサブスクの照合（#884）。DB・ネットワークに触れない純粋な部分。
 * クライアントからも型をimportするので、依存を持たない。
 *
 * 台帳（Asset Manager）の複製の正は作らない（#732）: 応答は保存せず、画面に出すだけ。
 * 契約の正は `docs/external-tool-contracts.md`（`asset_manager_subscriptions`）。
 */

export type RegisteredSubscription = {
  id: number;
  name: string;
  /** 「自動更新中」など。 */
  statusLabel: string;
  /** 1回あたりの請求額。 */
  amount: number | null;
  currency: "JPY" | "USD" | null;
  /** 「毎年12月1日」など、AIDEが整えた請求サイクルの文。 */
  billing: string | null;
  billingCycle: "MONTHLY" | "YEARLY" | null;
  nextBillingDay: string | null;
  daysUntilNextBilling: number | null;
  startDate: string | null;
  paymentMethod: string | null;
  labels: string[];
};

export type SubscriptionMatch =
  | { status: "matched"; matches: RegisteredSubscription[] }
  | { status: "none" }
  | { status: "error" };

/** 候補の上限（行の名前が短いと多く当たりうる）。 */
export const MATCH_MAX = 5;
/** 部分一致を認める最短の文字数（1文字の名前が何にでも当たるのを防ぐ）。 */
const MIN_PARTIAL = 2;

/** 全角半角・大文字小文字・空白・記号の違いを無視するための正規化。 */
export function normalizeSubscriptionName(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** `asset_manager_subscriptions` の応答から契約の一覧を読む。形が違えばnull（「無い」と混ぜない）。 */
export function parseRegisteredSubscriptions(json: unknown): RegisteredSubscription[] | null {
  if (!json || typeof json !== "object") return null;
  const root = json as Record<string, unknown>;
  if (root.status !== "ok" || !Array.isArray(root.subscriptions)) return null;
  const out: RegisteredSubscription[] = [];
  for (const raw of root.subscriptions) {
    if (!raw || typeof raw !== "object") continue;
    const s = raw as Record<string, unknown>;
    const id = num(s.id);
    const name = str(s.name);
    if (id === null || !name) continue;
    out.push({
      id,
      name,
      statusLabel: str(s.statusLabel) ?? "",
      amount: num(s.amount),
      currency: s.currency === "JPY" || s.currency === "USD" ? s.currency : null,
      billing: str(s.billing),
      billingCycle: s.billingCycle === "MONTHLY" || s.billingCycle === "YEARLY" ? s.billingCycle : null,
      nextBillingDay: str(s.nextBillingDay),
      daysUntilNextBilling: num(s.daysUntilNextBilling),
      startDate: str(s.startDate),
      paymentMethod: str(s.paymentMethod),
      labels: Array.isArray(s.labels) ? s.labels.filter((l): l is string => typeof l === "string") : [],
    });
  }
  return out;
}

/**
 * 提案の名称に合う登録済みの契約を選ぶ。完全一致（正規化後）があればそれだけ、無ければ双方向の部分一致
 * （「JAF年会費」⇔「JAF」）。誤りより「見つからない」へ倒すので、短すぎる名前は部分一致させない。
 */
export function matchSubscriptions(name: string, registered: RegisteredSubscription[]): RegisteredSubscription[] {
  const target = normalizeSubscriptionName(name);
  if (target === "") return [];
  const exact = registered.filter((r) => normalizeSubscriptionName(r.name) === target);
  if (exact.length > 0) return exact.slice(0, MATCH_MAX);
  return registered
    .filter((r) => {
      const other = normalizeSubscriptionName(r.name);
      const [short, long] = target.length <= other.length ? [target, other] : [other, target];
      return short.length >= MIN_PARTIAL && long.includes(short);
    })
    .slice(0, MATCH_MAX);
}
