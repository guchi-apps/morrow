import { parseRegisteredSubscriptions, resolveMatch, type ManualLink, type MatchQuery, type RegisteredSubscription, type SubscriptionMatch } from "@/lib/mail/subscription-match-core";
import { callToolJson, connectedServerFor } from "@/lib/mcp/direct-call";

/**
 * Asset Managerの登録済みの定期払いを読む（読み取りのみ・引数なし＝解約済みを除く全件）。**サーバー専用。**
 * 取れなかった回はnull（「無い」と混ぜない。#214）。結果はDB・メモリに残さない（台帳の複製の正を作らない。#732）。
 */
export async function loadRegisteredSubscriptions(userId: string): Promise<RegisteredSubscription[] | null> {
  const server = await connectedServerFor(userId, "aide");
  if (!server) return null;
  try {
    return parseRegisteredSubscriptions(await callToolJson(server, "asset_manager_subscriptions", {}));
  } catch (error) {
    console.error("[aide-bot] サブスクの照合に失敗した", error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * 提案（サブスク・家計簿）とAsset Managerの登録済みの照合（#884・#896）。
 * 利用者が手で選んだ紐づけ（#1130）があればそれを優先し、無ければ名前→金額の順で自動照合する。
 */
export async function matchRegisteredSubscription(userId: string, query: MatchQuery, link: ManualLink | null = null): Promise<SubscriptionMatch> {
  const registered = await loadRegisteredSubscriptions(userId);
  if (!registered) return { status: "error" };
  return resolveMatch(query, registered, link);
}
