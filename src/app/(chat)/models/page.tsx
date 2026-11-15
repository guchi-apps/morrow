import { redirect } from "next/navigation";

import { UsageChart } from "@/components/models/usage-chart";
import { ModelSettings } from "@/components/models/model-settings";
import { getCurrentUser } from "@/lib/auth-user";
import { modelSettingsFor } from "@/lib/chat-model-server";
import { dailyUsageRows } from "@/lib/usage";
import { buildDailyUsage, USAGE_CHART_DAYS } from "@/lib/usage-daily";

export const metadata = { title: "モデル" };

// 選んだモデルは保存の直後に反映されるので、キャッシュさせない。
export const dynamic = "force-dynamic";

/** 用途ごとに使うAIモデルを選ぶ画面（#349）。設定とは独立している。 */
export default async function ModelsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const now = new Date();
  // 使用量の取得に失敗しても、モデルを選ぶ画面は開けるようにする。
  const usage = await dailyUsageRows(user.id, now, USAGE_CHART_DAYS)
    .then((rows) => buildDailyUsage(rows, now, USAGE_CHART_DAYS))
    .catch((error) => {
      console.error("[aide-bot] 使用量の取得に失敗した", error);
      return null;
    });

  return (
    <div className="mobile-tab-pad min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 md:px-7">
        <UsageChart days={usage} />
        <ModelSettings initial={await modelSettingsFor(user.id)} />
      </div>
    </div>
  );
}
