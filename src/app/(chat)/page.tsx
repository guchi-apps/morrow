import { redirect } from "next/navigation";

import { DashboardView } from "@/components/dashboard/dashboard-view";
import { getCurrentUser } from "@/lib/auth-user";
import { dashboardTopics } from "@/lib/dashboard/today";
import { jstDayKey } from "@/lib/day-key";

/**
 * トップ（`/`）＝今日のダッシュボード（#573）。
 *
 * チャットをやめて「集めて・選んで・届ける」に絞る第1段階で、相談（今日の記録）は `/chat` へ移した。
 * 古い通知の `/c/<ID>` ・`/notices` もここへ転送する。
 * 「今日届いた通知」と「届いた通知」（`/pushes`）は#675で朝の見通し・先回りの提案とともに廃止した。
 *
 * 今日だけを出す（#1088。以前の `?d=` による前後の日めくり〔#606〕は廃止。`?d=` が付いていても無視する）。
 */
export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const now = new Date();
  const todayKey = jstDayKey(now);
  const topics = await dashboardTopics(user.id, now);

  return (
    <DashboardView
      userId={user.id}
      now={now}
      todayKey={todayKey}
      topics={topics}
    />
  );
}
