import { matchSubscriptions, parseRegisteredSubscriptions, type SubscriptionMatch } from "@/lib/mail/subscription-match-core";
import { callToolJson, connectedServerFor } from "@/lib/mcp/direct-call";

/**
 * サブスク提案とAsset Managerの登録済みの照合（#884）。**サーバー専用。**
 * AIDEの `asset_manager_subscriptions`（読み取りのみ・引数なし＝解約済みを除く全件）を毎回引いて名前で照合する。
 * 結果はDB・メモリに残さない（台帳の複製の正を作らない。#732）。取れなかった回は `error`（「無い」と混ぜない。#214）。
 */
export async function matchRegisteredSubscription(userId: string, name: string): Promise<SubscriptionMatch> {
  const server = await connectedServerFor(userId, "aide");
  if (!server) return { status: "error" };
  try {
    const registered = parseRegisteredSubscriptions(await callToolJson(server, "asset_manager_subscriptions", {}));
    if (!registered) return { status: "error" };
    const matches = matchSubscriptions(name, registered);
    return matches.length > 0 ? { status: "matched", matches } : { status: "none" };
  } catch (error) {
    console.error("[aide-bot] サブスクの照合に失敗した", error instanceof Error ? error.message : error);
    return { status: "error" };
  }
}
