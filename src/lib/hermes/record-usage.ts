import { recordApiUsage } from "@/lib/usage";
import type { HermesUsage } from "./contract.ts";
import { hermesUsageToApiUsage } from "./usage.ts";

/**
 * 1ターン終わったら `ApiUsage` へ1行残す（#737。機能 `hermes_chat`）。
 * チャットのRoute Handler（#728）が `message.complete` を受けた時点で呼ぶ。
 * **サーバー専用**（Prismaを引き込む）。失敗しても本筋は止めない（`recordApiUsage()` が握る）。
 */
export async function recordHermesTurnUsage(userId: string, usage: HermesUsage | undefined): Promise<void> {
  const mapped = hermesUsageToApiUsage(usage);
  if (!mapped) return;
  await recordApiUsage({ userId, feature: "hermes_chat", model: mapped.model, usage: mapped.usage });
}
