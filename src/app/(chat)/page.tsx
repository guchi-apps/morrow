import { redirect } from "next/navigation";

import { DashboardView } from "@/components/dashboard/dashboard-view";
import { getCurrentUser } from "@/lib/auth-user";
import { addDays, resolveDayOffset } from "@/lib/dashboard/day-offset";
import { dashboardNotices, dashboardTopics, pushesOn } from "@/lib/dashboard/today";
import { jstDayKey } from "@/lib/day-key";

/**
 * トップ（`/`）＝今日のダッシュボード（#573）。
 *
 * チャットをやめて「集めて・選んで・届ける」に絞る第1段階で、相談（今日の記録）は `/chat` へ移した。
 * **通知（朝の見通し・急ぎのお知らせ・先回りの提案）を押した先もここ**で、本文は「今日届いた通知」に
 * 出る。きのう以前の本文は「届いた通知」（`/pushes`。#581）で読み、古い通知の `/c/<ID>` もそちらへ転送する。
 *
 * `?d=YYYY-MM-DD` で前後の日（今日から±`DAY_RANGE`日）を出す（#606。スワイプ・‹ ›）。無い・読めない値は今日、
 * 範囲外は端へ丸める。未来の日は届いた通知を引かない。
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
  const dayKey = addDays(todayKey, offset);

  const [pushes, notices, topics] = await Promise.all([
    offset <= 0 ? pushesOn(user.id, dayKey) : Promise.resolve([]),
    dashboardNotices(user.id, now),
    offset === 0 ? dashboardTopics(user.id, now) : Promise.resolve([]),
  ]);

  return (
    <DashboardView
      userId={user.id}
      now={now}
      todayKey={todayKey}
      offset={offset}
      pushes={pushes}
      notices={notices}
      topics={topics}
    />
  );
}
