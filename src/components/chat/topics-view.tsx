import { Clock, Newspaper } from "lucide-react";

import { HeaderDialog } from "@/components/chat/header-dialog";
import { jstTimeLabel } from "@/lib/day-key";
import type { TopicBoard } from "@/lib/topics";

import { ScheduledPushSettingsCard, type ScheduleRow } from "@/components/settings/scheduled-push-settings";

import { TopicCategoryPicker } from "./topic-category-picker";
import { TopicRefreshButton } from "./topic-refresh-button";
import { TopicSeenMarker } from "./topic-seen-marker";
import { TopicTabs } from "./topic-tabs";

type Props = {
  board: TopicBoard;
  /** 描画の基準になる時刻。「◯時間前」の計算に使う（サーバー側で決めて渡す）。 */
  now: Date;
  /** 前回この画面を開いた時刻（#418）。nullは初回で、全件を既読として出す。 */
  seenAt: Date | null;
  /** 通知する時間（定時のお知らせ。#344）。設定画面からニュース画面へ移した（#418）。 */
  schedules: ScheduleRow[];
  hasDevice: boolean;
};

/**
 * 仕入れたニュースの一覧（#144）。
 *
 * `/notices` と同じくサーバーコンポーネントのまま置き、テーマ別タブ・種類を選ぶ部品だけを
 * クライアントにする（#404）。並べる順は新しい順。まずニュースをまとめて読めるようにし、
 * 仕入れる種類の管理は必要なときだけ開く。
 */
export function TopicsView({ board, now, seenAt, schedules, hasDevice }: Props) {
  const { categories, lastFetchedAt, topics, byCategory, mergedCount, bubbleLimit, lifetimeHours } = board;

  const enabledCategories = categories.filter((category) => category.enabled);

  return (
    <div className="mobile-tab-pad min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[900px] flex-col gap-4 px-3.5 py-4 md:gap-5 md:px-7 md:py-6">
        <TopicSeenMarker renderedAt={now.toISOString()} />
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-base font-bold tracking-tight">いまのニュース</h2>
          <span className="text-[0.6875rem] text-muted">
            {lastFetchedAt
              ? `最終取得 ${jstTimeLabel(lastFetchedAt)}（${elapsedLabel(lastFetchedAt, now)}）`
              : enabledCategories.length === 0
                ? "仕入れを止めています"
                : "まだ取得していません"}
          </span>
        </div>

        <TopicRefreshButton />

        <HeaderDialog
          icon={Clock}
          label="通知する時間"
          badge={schedules.length}
          summary={
            schedules.length > 0
              ? hasDevice
                ? `${schedules.length}件登録中`
                : `${schedules.length}件登録中・通知する端末が未登録`
              : "未登録"
          }
        >
          <ScheduledPushSettingsCard initial={schedules} hasDevice={hasDevice} categories={categories} />
        </HeaderDialog>

        {topics.length === 0 ? (
          <p className="rounded-xl border border-border bg-surface px-4 py-3 text-xs leading-relaxed text-muted">
            {enabledCategories.length === 0
              ? "仕入れを止めています。ヘッダーの「通知する内容」で種類を1つ以上チェックしてから「最近の記事を取得する」を押してください。"
              : "まだニュースがありません。「最近の記事を取得する」を押すと仕入れが始まり、30秒ほどで並びます。"}
          </p>
        ) : (
          <TopicTabs categories={categories} allTopics={topics} byCategory={byCategory} mergedCount={mergedCount} seenAt={seenAt} now={now} />
        )}

        <HeaderDialog
          icon={Newspaper}
          label="通知する内容"
          badge={enabledCategories.length}
          summary={enabledCategories.length > 0 ? `ニュースを仕入れる種類・${enabledCategories.length}種類を仕入れ中` : "ニュースを仕入れる種類・仕入れを止めています"}
        >
          <p className="text-[0.6875rem] leading-relaxed text-muted">
            チェックした種類だけを、定時のお知らせの前と「最近の記事を取得する」を押したときにウェブで調べます。
          </p>
          <TopicCategoryPicker initial={categories} />
        </HeaderDialog>

        <p className="text-[0.6875rem] leading-relaxed text-muted">
          <b className="font-medium text-foreground">
            ニュースはお知らせとは別の場所に溜まり、通知（Push）はヘッダーの「通知する時間」に設定した時刻にだけ届きます。
          </b>
          ダッシュボードに出るのは新しい{bubbleLimit}件だけで、{lifetimeHours}時間経つと入れ替わります。要点と一言はモデルが
          記事から書いたもので、細部は出典の記事で確かめてください。
        </p>
      </div>
    </div>
  );
}

/** 「3分前」「2時間前」。 */
function elapsedLabel(date: Date, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - date.getTime()) / 60000));
  if (minutes < 1) return "たったいま";
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  return `${Math.floor(hours / 24)}日前`;
}
