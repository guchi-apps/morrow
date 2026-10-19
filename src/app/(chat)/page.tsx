import { redirect } from "next/navigation";

import { DashboardView } from "@/components/dashboard/dashboard-view";
import { getCurrentUser } from "@/lib/auth-user";
import { dashboardNotices, dashboardTopics, todaysPushes } from "@/lib/dashboard/today";
import { dayLabel, jstDayKey } from "@/lib/day-key";

/**
 * トップ（`/`）＝今日のダッシュボード（#573）。
 *
 * チャットをやめて「集めて・選んで・届ける」に絞る第1段階で、相談（今日の記録）は `/chat` へ移した。
 * **通知（朝の見通し・急ぎのお知らせ・先回りの提案）を押した先もここ**で、本文は「今日届いた通知」に
 * 出る。古い通知の `/c/<ID>` もここへ転送される。
 */
export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const now = new Date();
  const todayKey = jstDayKey(now);

  const [pushes, notices, topics] = await Promise.all([
    todaysPushes(user.id, now),
    dashboardNotices(user.id, now),
    dashboardTopics(user.id, now),
  ]);

  return (
    <DashboardView
      userId={user.id}
      now={now}
      heading={dayLabel(todayKey)}
      pushes={pushes}
      notices={notices}
      topics={topics}
    />
  );
}
