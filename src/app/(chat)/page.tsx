import { redirect } from "next/navigation";

import { DashboardView } from "@/components/dashboard/dashboard-view";
import { getCurrentUser } from "@/lib/auth-user";
import { resolveDayOffset } from "@/lib/dashboard/day-offset";
import { dashboardTopics } from "@/lib/dashboard/today";
import { jstDayKey } from "@/lib/day-key";

/**
 * トップ（`/`）＝今日のダッシュボード（#573）。
 *
 * チャットをやめて「集めて・選んで・届ける」に絞る第1段階で、相談（今日の記録）は `/chat` へ移した。
 * 古い通知の `/c/<ID>` ・`/notices` もここへ転送する。
 * 「今日届いた通知」と「届いた通知」（`/pushes`）は#675で朝の見通し・先回りの提案とともに廃止した。
 *
 * `?d=YYYY-MM-DD` で前後の日（今日から±`DAY_RANGE`日）を出す（#606。スワイプ・‹ ›）。無い・読めない値は今日、
 * 範囲外は端へ丸める。
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const now = new Date();
  const todayKey = jstDayKey(now);
  const offset = resolveDayOffset(todayKey, (await searchParams).d);

  const topics = offset === 0 ? await dashboardTopics(user.id, now) : [];

  return (
    <DashboardView
      userId={user.id}
      now={now}
      todayKey={todayKey}
      offset={offset}
      topics={topics}
    />
  );
}
