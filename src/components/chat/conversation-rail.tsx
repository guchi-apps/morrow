"use client";

import { Cpu, LayoutDashboard, Mail, Newspaper, Settings, Sun } from "lucide-react";
import Link from "next/link";

import { AppLogo } from "@/components/brand/app-icon";
import { cn } from "@/lib/utils";

type Props = {
  /** 今日のダッシュボード（`/`。#573）を開いているか。 */
  isDashboardActive: boolean;
  /** 設定の画面を開いているか（#46）。 */
  isSettingsActive: boolean;
  /** ニュースの画面を開いているか（#144）。 */
  isTopicsActive: boolean;
  /** メールの画面を開いているか（#683）。 */
  isMailActive: boolean;
  isWeatherActive: boolean;
  /** モデルの画面を開いているか（#349）。 */
  isModelsActive: boolean;
  /** 溜まっているニュースの件数（#144）。0のときは数字を出さない。 */
  topicCount: number;
  userLabel: string;
  userEmail: string | null;
  appVersion: string;
  onNavigate?: () => void;
};

/**
 * 左のメニュー。PCでは常に見えている左の帯、スマホではドロワーの中身として同じものを使う。
 *
 * #574で相談（今日の記録）と日付の一覧をやめたので、並ぶのはダッシュボードと各画面へのリンクだけ。
 */
export function ConversationRail({
  isDashboardActive,
  isSettingsActive,
  isTopicsActive,
  isMailActive,
  isWeatherActive,
  isModelsActive,
  topicCount,
  userLabel,
  userEmail,
  appVersion,
  onNavigate,
}: Props) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-rail">
      <div className="flex flex-col gap-3.5 px-4 pb-3.5 pt-4">
        <AppLogo className="text-xl" />

        <Link
          href="/"
          onClick={onNavigate}
          aria-current={isDashboardActive ? "page" : undefined}
          className="flex items-center justify-center gap-1.5 rounded-[10px] bg-accent px-3 py-2.5 text-[0.8125rem] font-medium text-accent-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <LayoutDashboard className="size-3.5" aria-hidden="true" />
          今日
        </Link>
      </div>

      <div className="min-h-0 flex-1" />

      <div className="border-t border-border">
        {/* 天気（#695）。登録した地点の1日の予報。 */}
        <Link
          href="/weather"
          onClick={onNavigate}
          aria-current={isWeatherActive ? "page" : undefined}
          className={cn(
            "mx-2.5 mt-2 flex items-center gap-1.5 rounded-[9px] px-2.5 py-2 text-[0.8125rem] transition-colors hover:bg-rail-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            isWeatherActive && "bg-rail-active shadow-[inset_2px_0_0_var(--accent)]",
          )}
        >
          <Sun className="size-3.5 text-muted" aria-hidden="true" />
          天気
        </Link>

        {/* メール（#683）。未読数は出さない——描画のたびにAIDEへ一覧を取りに行くことになるため。 */}
        <Link
          href="/mail"
          onClick={onNavigate}
          aria-current={isMailActive ? "page" : undefined}
          className={cn(
            "mx-2.5 mt-2 flex items-center gap-1.5 rounded-[9px] px-2.5 py-2 text-[0.8125rem] transition-colors hover:bg-rail-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            isMailActive && "bg-rail-active shadow-[inset_2px_0_0_var(--accent)]",
          )}
        >
          <Mail className="size-3.5 text-muted" aria-hidden="true" />
          メール
        </Link>

        {/* 仕入れたニュース（#144）。お知らせとは別の受け皿で、数字は「未読」ではなく溜まっている件数。
            用件ではないので、お知らせと違って数字を強調しない。 */}
        <Link
          href="/topics"
          onClick={onNavigate}
          aria-current={isTopicsActive ? "page" : undefined}
          className={cn(
            "mx-2.5 mt-2 flex items-center justify-between gap-2 rounded-[9px] px-2.5 py-2 text-[0.8125rem] transition-colors hover:bg-rail-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            isTopicsActive && "bg-rail-active shadow-[inset_2px_0_0_var(--accent)]",
          )}
        >
          <span className="flex items-center gap-1.5">
            <Newspaper className="size-3.5 text-muted" aria-hidden="true" />
            ニュース
          </span>
          {topicCount > 0 && <span className="tabular-nums text-xs font-medium text-muted">{topicCount}件</span>}
        </Link>

        {/* 用途ごとのAIモデル（#349。旧・設定の「返答のモデル」#71）。設定とは独立した画面。 */}
        <Link
          href="/models"
          onClick={onNavigate}
          aria-current={isModelsActive ? "page" : undefined}
          className={cn(
            "mx-2.5 mt-2 flex items-center gap-1.5 rounded-[9px] px-2.5 py-2 text-[0.8125rem] transition-colors hover:bg-rail-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            isModelsActive && "bg-rail-active shadow-[inset_2px_0_0_var(--accent)]",
          )}
        >
          <Cpu className="size-3.5 text-muted" aria-hidden="true" />
          モデル
        </Link>

        {/* 外部サービスとの接続（#46）ほか。下部に置く。 */}
        <Link
          href="/settings"
          onClick={onNavigate}
          aria-current={isSettingsActive ? "page" : undefined}
          className={cn(
            "mx-2.5 mt-2 flex items-center gap-1.5 rounded-[9px] px-2.5 py-2 text-[0.8125rem] transition-colors hover:bg-rail-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            isSettingsActive && "bg-rail-active shadow-[inset_2px_0_0_var(--accent)]",
          )}
        >
          <Settings className="size-3.5 text-muted" aria-hidden="true" />
          設定
        </Link>

        <div className="flex items-center justify-between gap-2.5 px-4 pb-2 pt-3">
          <div className="min-w-0">
            <b className="block text-[0.8125rem] font-medium">{userLabel}</b>
            {userEmail && <span className="block truncate text-[0.6875rem] text-muted">{userEmail}</span>}
          </div>

          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="whitespace-nowrap rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-muted transition-colors hover:bg-rail-active"
            >
              ログアウト
            </button>
          </form>
        </div>

        {/* どの版を見ているかが画面だけで分かるようにする。値は package.json の version。 */}
        <p className="px-4 pb-3 text-[0.6875rem] text-muted">v{appVersion}</p>
      </div>
    </div>
  );
}
