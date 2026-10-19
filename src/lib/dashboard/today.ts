import { db } from "@/lib/db";
import { dayStart, jstDayKey } from "@/lib/day-key";
import { PUSH_HISTORY_LIMIT } from "@/lib/dashboard/push-history";
import { noticeBoard } from "@/lib/notice-list";
import { PUSH_KIND_INFO, isPushKind } from "@/lib/push/kinds";
import { listTopicCategories } from "@/lib/topic-category-store";
import { topicCategoryShort } from "@/lib/topic-categories";
import { topicsForBubble } from "@/lib/topics";

/**
 * ダッシュボードのうち、Morrow自身のDBから出すもの（#573）。モデルもAIDEも呼ばない。
 */

/** 「今日届いた通知」に並べる種類。定時のお知らせは話題の画面（`/topics`）が受け皿なので外す。 */
const DASHBOARD_PUSH_KINDS = ["morning-briefing", "morning-topics", "urgent-notice", "proactive-suggestion"];

export type DeliveredPush = {
  id: string;
  kind: string;
  /** 種類の名前（「朝の見通し」など）。 */
  label: string;
  title: string;
  body: string;
  createdAt: Date;
  urgent: boolean;
};

/**
 * 今日（日本時間）送った通知の本文。**通知を押した先（`/`）で本文を読めるようにする**のが目的。
 *
 * 正は `NotificationLog`（朝の見通し・急ぎ・先回りの提案はどれも送った本文をここへ残している）。
 * 本文が空の行（朝の見通しが黙った日の記録）は出さない。届いた端末が0件の回も出す——
 * 端末の購読が落ちていただけで、用件そのものは今日あったため。
 */
export async function todaysPushes(userId: string, now = new Date()): Promise<DeliveredPush[]> {
  const rows = await db.notificationLog.findMany({
    where: {
      userId,
      kind: { in: DASHBOARD_PUSH_KINDS },
      createdAt: { gte: dayStart(jstDayKey(now)) },
      NOT: { body: "" },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 30,
  });

  return rows.map(toDeliveredPush);
}

/**
 * 日をまたいで遡る、送った通知の本文（「届いた通知」`/pushes`。#581）。新しい順に最大
 * `PUSH_HISTORY_LIMIT` 件。条件は今日の分（`todaysPushes()`）と同じで、日付の下限だけを外す。
 *
 * **端末に残っている前日以前の通知を開いたときの受け皿。** #574で会話・過去の日の画面が無くなり、
 * ダッシュボードは今日の分しか出さないので、ここが無いと古い通知の本文へ辿れない。
 */
export async function pushHistory(userId: string): Promise<DeliveredPush[]> {
  const rows = await db.notificationLog.findMany({
    where: { userId, kind: { in: DASHBOARD_PUSH_KINDS }, NOT: { body: "" } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PUSH_HISTORY_LIMIT,
  });
  return rows.map(toDeliveredPush);
}

function toDeliveredPush(row: { id: string; kind: string; title: string; body: string; createdAt: Date }): DeliveredPush {
  return {
    id: row.id,
    kind: row.kind,
    label: isPushKind(row.kind) ? PUSH_KIND_INFO[row.kind].label : row.title,
    title: row.title,
    body: row.body,
    createdAt: row.createdAt,
    urgent: row.kind === "urgent-notice",
  };
}

export type DashboardNotices = {
  /**
   * いま秘書が出している一言。無ければnull。形は `/api/notices/current` の `notice` と同じにしてあり、
   * 画面の問い合わせ（`LiveNoticeLine`）の応答でそのまま置き換わる。
   */
  current: { id: string; text: string; urgent: boolean; shownAt: string; url: string | null } | null;
  pendingCount: number;
  urgentCount: number;
};

export async function dashboardNotices(userId: string, now = new Date()): Promise<DashboardNotices> {
  const board = await noticeBoard(userId, now);
  return {
    current:
      board.current?.shownAt && board.current.spokenText
        ? {
            id: board.current.id,
            text: board.current.spokenText,
            urgent: board.current.spokenUrgent,
            shownAt: board.current.shownAt.toISOString(),
            url: board.current.url,
          }
        : null,
    pendingCount: board.pending.length,
    urgentCount: board.pending.filter((notice) => notice.priority === "URGENT").length,
  };
}

export type DashboardTopic = { id: string; title: string; lead: string; url: string | null; chip: string };

/** 話題の最新数件（吹き出しと同じ選び方・同じ出来事は1件にまとめ済み）。 */
export async function dashboardTopics(userId: string, now = new Date()): Promise<DashboardTopic[]> {
  const [topics, categories] = await Promise.all([topicsForBubble(userId, now), listTopicCategories(userId)]);
  return topics.map((topic) => ({
    id: topic.id,
    title: topic.title,
    lead: topic.lead,
    url: topic.url,
    chip: topicCategoryShort(categories, topic.category),
  }));
}
