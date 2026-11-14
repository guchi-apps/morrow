"use client";

import { Menu, X } from "lucide-react";

import { HEADER_ACTIONS_ID } from "@/components/chat/header-actions";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { ConversationRail } from "./conversation-rail";
import { MobileTabBar } from "./mobile-tab-bar";
import { useVisualViewportFit } from "./use-visual-viewport";

type Props = {
  /** 溜まっているニュースの件数（#144）。一覧の下に出す。 */
  topicCount: number;
  /** Hermesの確認待ちの件数（#794）。 */
  pendingProposalCount: number;
  userLabel: string;
  userEmail: string | null;
  appVersion: string;
  /** メニュー上部の情報カード（#719）。 */
  infoSlot?: React.ReactNode;
  /** メニューの「メール」の未読バッジ（#877）。 */
  mailBadgeSlot?: React.ReactNode;
  children: React.ReactNode;
};

/**
 * 画面の外枠。メニュー（PCは常設の帯、スマホはドロワー）と上部の見出しを持つ。
 *
 * 高さから `env(safe-area-inset-bottom)` を引いているのは、body側で同じぶんの余白を
 * 取っているため。100dvhのままだと合計が画面より高くなり、ページ全体が数十pxだけ
 * 縦スクロールする（ホーム画面から起動したiOSで顕著）。
 *
 * **ページそのものが上下にスクロールしないことの担保は `html`/`body`（`src/app/layout.tsx`）
 * 側の `overflow-hidden`・`overscroll-none` が持つ**（#191）。この`ChatShell`のルートに
 * ある `overflow-hidden` は、この中で内容が縦に収まりきらないときの見た目のクリップ用で、
 * iOSのタッチのラバーバンド（弾性スクロール）まではデスクトップの検証では再現できず、
 * `html`/`body` 側で塞ぐ必要があった。各画面の内部スクロール（一覧・記録欄・設定パネル等）は
 * `overflow-y-auto` の入れ物ごとに閉じているので、ここを固定しても壊れない。
 *
 * 高さの元は `--app-height`（ふだんは100dvh）と `--app-bottom-inset`（`globals.css`）。
 * 画面キーボードが出ている間は `useVisualViewportFit()` がキーボードの上に残る高さへ縮める
 * （#379。iOSでキーボードを閉じた後にページが持ち上がったまま残るのを防ぐ）。
 */
export function ChatShell({
  topicCount,
  pendingProposalCount,
  userLabel,
  userEmail,
  appVersion,
  infoSlot,
  mailBadgeSlot,
  children,
}: Props) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  useVisualViewportFit();
  // スワイプでの開閉（#434）は、横スクロール・別の左右スワイプと干渉するため廃止した（#600）。開閉はボタンだけ。
  // aria-modalのドロワーのフォーカス制御（#464）。開いたら閉じるボタンへ移し、閉じたら開いたボタンへ戻す。
  const openerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);

  // トップ（`/`）は今日のダッシュボード（#573）。
  const isDashboard = pathname === "/";
  const isSettings = pathname === "/settings";
  const isTopics = pathname === "/topics";
  const isModels = pathname === "/models";
  const isMail = pathname === "/mail" || pathname.startsWith("/mail/");
  const isWeather = pathname === "/weather";
  const isChat = pathname === "/chat";
  const heading = isDashboard
    ? "ホーム"
    : isSettings
      ? "設定"
      : isTopics
        ? "ニュース"
        : isModels
          ? "モデル"
          : isMail
            ? "メール"
            : isWeather
              ? "天気"
              : isChat
                ? "チャット"
                : "Morrow";

  // 開いたドロワーは、閉じるボタン・スクリム・中のリンク（onNavigate）で閉じる。
  // pathnameの変化をuseEffectで見て閉じる形にはしない——描画のたびにsetStateが走る。

  useEffect(() => {
    if (drawerOpen) {
      closeRef.current?.focus();
    } else if (wasOpenRef.current) {
      openerRef.current?.focus();
    }
    wasOpenRef.current = drawerOpen;
  }, [drawerOpen]);

  // ドロワーは lg 未満でしか見えない。開いたまま lg 以上へ広がると背面が操作できなくなるので閉じる。
  useEffect(() => {
    if (!drawerOpen) return;
    const query = window.matchMedia("(min-width: 1024px)");
    const onChange = () => {
      if (query.matches) setDrawerOpen(false);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [drawerOpen]);

  useEffect(() => {
    if (!drawerOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  return (
    <div className="flex h-[calc(var(--app-height)_-_var(--app-bottom-inset))] w-full overflow-hidden">
      {/* iPadは横向き（1024px以上）で初めて一覧を常設する。縦向きまで2カラムにすると、本文がスマホより狭くなる。 */}
      <aside className="hidden w-[276px] shrink-0 border-r border-border lg:block" inert={drawerOpen}>
        <ConversationRail
          isDashboardActive={isDashboard}
          isSettingsActive={isSettings}
          isTopicsActive={isTopics}
          isMailActive={isMail}
          isWeatherActive={isWeather}
          isChatActive={isChat}
          pendingProposalCount={pendingProposalCount}
          isModelsActive={isModels}
          topicCount={topicCount}
          userLabel={userLabel}
          userEmail={userEmail}
          appVersion={appVersion}
          infoSlot={infoSlot}
          mailBadgeSlot={mailBadgeSlot}
        />
      </aside>

      {/* 閉じている間も描画して位置だけ動かす（開閉のアニメーションのため）。`inert` で操作もフォーカスも止める。 */}
      <div className="lg:hidden" inert={!drawerOpen}>
          <button
            type="button"
            aria-label="メニューを閉じる"
            tabIndex={drawerOpen ? 0 : -1}
            onClick={() => setDrawerOpen(false)}
            // ライト・ダークのどちらでも背後を沈ませたいので、テーマ変数ではなく黒を敷く。
            className={cn(
              "fixed inset-0 z-40 bg-black/50 transition-opacity duration-200 motion-reduce:transition-none",
              drawerOpen ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="メニュー"
            className={cn(
              "fixed inset-y-0 left-0 z-50 w-[calc(100%_-_72px)] max-w-[320px] border-r border-border",
              "transition-transform duration-200 motion-reduce:transition-none",
              drawerOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full",
            )}
          >
            <ConversationRail
              isDashboardActive={isDashboard}
              isSettingsActive={isSettings}
              isTopicsActive={isTopics}
          isMailActive={isMail}
          isWeatherActive={isWeather}
          isChatActive={isChat}
          pendingProposalCount={pendingProposalCount}
              isModelsActive={isModels}
              topicCount={topicCount}
              userLabel={userLabel}
              userEmail={userEmail}
              appVersion={appVersion}
          infoSlot={infoSlot}
          mailBadgeSlot={mailBadgeSlot}
              onNavigate={() => setDrawerOpen(false)}
            />
            <button
              ref={closeRef}
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="absolute right-2 top-2 grid size-9 place-items-center rounded-lg text-muted transition-colors hover:bg-rail-active"
            >
              <X className="size-4" aria-hidden="true" />
              <span className="sr-only">閉じる</span>
            </button>
          </div>
      </div>

      <div className="mobile-tab-pad flex min-w-0 flex-1 flex-col" inert={drawerOpen}>
        <header className="flex items-center gap-2.5 border-b border-border bg-surface px-3 pb-2.5 pt-[calc(env(safe-area-inset-top)+0.625rem)] lg:bg-transparent lg:px-7 lg:py-3.5">
          <button
            ref={openerRef}
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="grid size-[34px] shrink-0 place-items-center rounded-[10px] border border-border bg-background transition-colors hover:bg-rail-active lg:hidden"
          >
            <Menu className="size-4" aria-hidden="true" />
            <span className="sr-only">メニューを開く</span>
          </button>

          <h1 className="min-w-0 flex-1 truncate text-center text-sm font-medium lg:text-left lg:text-[0.9375rem]">
            {heading}
          </h1>

          {/* 画面ごとの操作アイコンの置き場（メール本文の既読/アーカイブなど。#883）。中身はポータルで入る */}
          <div id={HEADER_ACTIONS_ID} className="flex shrink-0 items-center gap-1.5 empty:hidden" />
        </header>

        {children}
      </div>

      {/* スマホの下部固定ナビ（#916）。ドロワーが開いている間は背面なので操作させない。 */}
      <div inert={drawerOpen}>
        <MobileTabBar
          isDashboardActive={isDashboard}
          isWeatherActive={isWeather}
          isChatActive={isChat}
          isMailActive={isMail}
          isTopicsActive={isTopics}
          pendingProposalCount={pendingProposalCount}
          topicCount={topicCount}
          mailBadgeSlot={mailBadgeSlot}
        />
      </div>
    </div>
  );
}
