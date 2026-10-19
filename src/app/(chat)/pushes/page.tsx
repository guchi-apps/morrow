import { redirect } from "next/navigation";

import { PushHistoryView } from "@/components/dashboard/push-history-view";
import { getCurrentUser } from "@/lib/auth-user";
import { PUSH_HISTORY_LIMIT, groupPushesByDay } from "@/lib/dashboard/push-history";
import { pushHistory } from "@/lib/dashboard/today";

// 通知を送るたびに変わるので、ビルド時の値を配らない。
export const dynamic = "force-dynamic";

export const metadata = { title: "届いた通知" };

/**
 * 届いた通知（#581）。ログイン中の本人ぶんだけを出す。
 *
 * #574で会話・過去の日の画面（`/d/<日付>`）が無くなり、ダッシュボード（`/`）は今日の分しか出さない。
 * **端末に残っている前日以前の通知の本文へ辿る受け皿**で、古い `/c/<ID>` はここへ転送する。
 */
export default async function PushHistoryPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const days = groupPushesByDay(await pushHistory(user.id));
  return <PushHistoryView days={days} limit={PUSH_HISTORY_LIMIT} />;
}
