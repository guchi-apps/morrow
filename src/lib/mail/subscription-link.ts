/**
 * メールの提案（#709）の「サブスクに登録する」。Morrowからは書き込まず、読み取った値を持たせて
 * Asset Managerのサブスク画面を開く（登録そのものはAsset Manager側で完了させる）。
 * クライアントからもimportするので、依存を持たない純粋な関数だけを置く。
 *
 * **URLに載せるのは名称・金額・通貨・周期・請求日・開始日だけ**（メール本文・差出人は載せない）。
 * 受け側（Asset Manager）がクエリを読んで登録フォームを埋める口は別Issueで追う。
 */

export const ASSET_MANAGER_SUBSCRIPTIONS_URL = "https://asset.gucchii.com/subscriptions";

export type SubscriptionFields = {
  name: string;
  /** 1回あたりの請求額。読み取れないときはnull。 */
  amount: number | null;
  currency: "JPY" | "USD";
  cycle: "MONTHLY" | "YEARLY";
  /** 請求日（1〜31）。読み取れないときはnull。 */
  day: number | null;
  /** 契約開始日 `YYYY-MM-DD`。読み取れないときはnull。 */
  startDate: string | null;
};

export function subscriptionLink(fields: SubscriptionFields): string {
  const params = new URLSearchParams({ new: "1", name: fields.name, currency: fields.currency, cycle: fields.cycle });
  if (fields.amount !== null) params.set("amount", String(fields.amount));
  if (fields.day !== null) params.set("day", String(fields.day));
  if (fields.startDate) params.set("start", fields.startDate);
  return `${ASSET_MANAGER_SUBSCRIPTIONS_URL}?${params.toString()}`;
}
