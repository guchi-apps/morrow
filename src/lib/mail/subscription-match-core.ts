/**
 * メールのサブスク提案と、Asset Managerに登録済みのサブスクの照合（#884）。DB・ネットワークに触れない純粋な部分。
 * クライアントからも型をimportするので、依存を持たない。
 *
 * 台帳（Asset Manager）の複製の正は作らない（#732）: 応答は保存せず、画面に出すだけ。
 * 契約の正は `docs/external-tool-contracts.md`（`asset_manager_subscriptions`）。
 */

import type { Suggestion } from "@/lib/mail/suggest-core";

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

/**
 * 照合の結果。`by` は見つけ方（#896）: `name`＝名前で一致、`amount`＝名前では見つからず、円建ての1回あたりの金額が
 * 一致する登録がちょうど1件だった（名前は一致していないので、画面で確かめてもらう）。
 */
export type SubscriptionMatch =
  | { status: "matched"; by: "name" | "amount"; matches: RegisteredSubscription[] }
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

/** 照合に使う提案の手掛かり（#896）。名前は複数（家計簿なら支払先・品名）、金額は1回あたり。 */
export type MatchQuery = { names: string[]; amount: number | null; currency: "JPY" | "USD" | null };

/** 照合に使う名前の上限（画面から送られる数を絞る）。 */
export const MATCH_NAMES_MAX = 3;

/**
 * 提案から照合の手掛かりを作る（#896）。サブスクは名称と1回あたりの金額、家計簿は支払先・品名と円建ての合計。
 * 予定・タスク、手掛かりが何も無い提案はnull（照合しない）。
 */
export function matchQueryOf(card: Suggestion): MatchQuery | null {
  const clean = (values: (string | null | undefined)[]) =>
    [...new Set(values.map((v) => (v ?? "").trim()).filter(Boolean))].slice(0, MATCH_NAMES_MAX);
  let query: MatchQuery | null = null;
  if (card.kind === "subscription") {
    query = { names: clean([card.fields.name]), amount: card.fields.amount, currency: card.fields.currency };
  } else if (card.kind === "payment") {
    const f = card.fields;
    // 品目が1つならその名前、無ければ1行の品名（複数品目の明細は定期払いの名前にならないので使わない）
    const item = f.items.length === 1 ? f.items[0].name : f.items.length === 0 ? f.name : null;
    // 外貨建ての支払い（`originalCurrency` あり）は円換算の合計が請求額と合わないので、金額では照合しない（#896の計画レビュー）
    const foreign = f.originalCurrency !== null && f.originalCurrency.toUpperCase() !== "JPY";
    const amount = foreign ? null : f.amount;
    query = { names: clean([f.place, item]), amount, currency: amount !== null ? "JPY" : null };
  }
  if (!query || (query.names.length === 0 && query.amount === null)) return null;
  return query;
}

/**
 * 提案を登録済みの契約と照合する（#896）。名前（並びの順に試し、最初に見つかったもの）を優先し、名前で見つからなければ
 * **円建ての1回あたりの金額が一致する登録がちょうど1件**のときだけ金額で一致とする（KDDIの請求⇔「iPhone15」のように、
 * 請求元と登録名が違う定期払いのため）。複数・外貨・金額不明は当てない（誤りより「見つからない」へ倒す）。
 */
export function matchRegistered(query: MatchQuery, registered: RegisteredSubscription[]): SubscriptionMatch {
  for (const name of query.names) {
    const matches = matchSubscriptions(name, registered);
    if (matches.length > 0) return { status: "matched", by: "name", matches };
  }
  if (query.currency === "JPY" && query.amount !== null && Number.isFinite(query.amount) && query.amount > 0) {
    const same = registered.filter((r) => r.currency === "JPY" && r.amount === query.amount);
    if (same.length === 1) return { status: "matched", by: "amount", matches: same };
  }
  return { status: "none" };
}
