"use client";

import { LayoutDashboard, Mail, MessageSquare, Newspaper, Sun } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

import { MenuBadge } from "./menu-badge";

type Props = {
  isDashboardActive: boolean;
  isWeatherActive: boolean;
  isChatActive: boolean;
  isMailActive: boolean;
  isTopicsActive: boolean;
  /** Hermesの確認待ちの件数（#794）。 */
  pendingProposalCount: number;
  /** 溜まっているニュースの件数（#144）。 */
  topicCount: number;
  /** メールの未読バッジ（#877）。AIDE待ちなので `Suspense` で後から流れてくる。 */
  mailBadgeSlot?: React.ReactNode;
};

const BADGE_POSITION = "absolute left-[calc(50%+4px)] top-1";

/**
 * スマホ（lg未満）の下部固定ナビ（#916）。ホーム・天気・チャット・メール・ニュースの5つ。
 * 背面がぼけて透けるピル型のバーで、選んでいる項目は丸いハイライトで示す。
 * lg以上は左の帯（`ConversationRail`）があるので出さない。設定・モデルは従来どおりドロワーから。
 *
 * 画面キーボードが出ている間は隠す（`html[data-keyboard="open"]`。`useVisualViewportFit()` が立てる）。
 * 余白は `ChatShell` 側が同じ条件で取っている。
 */
export function MobileTabBar({
  isDashboardActive,
  isWeatherActive,
  isChatActive,
  isMailActive,
  isTopicsActive,
  pendingProposalCount,
  topicCount,
  mailBadgeSlot,
}: Props) {
  const tabs = [
    { href: "/", label: "ホーム", Icon: LayoutDashboard, active: isDashboardActive, badge: null },
    { href: "/weather", label: "天気", Icon: Sun, active: isWeatherActive, badge: null },
    {
      href: "/chat",
      label: "チャット",
      Icon: MessageSquare,
      active: isChatActive,
      badge: (
        <MenuBadge
          count={pendingProposalCount}
          label={`確認待ち${pendingProposalCount}件`}
          className={BADGE_POSITION}
        />
      ),
    },
    {
      href: "/mail",
      label: "メール",
      Icon: Mail,
      active: isMailActive,
      badge: mailBadgeSlot ? <span className={BADGE_POSITION}>{mailBadgeSlot}</span> : null,
    },
    {
      href: "/topics",
      label: "ニュース",
      Icon: Newspaper,
      active: isTopicsActive,
      badge: (
        <MenuBadge count={topicCount} label={`ニュース${topicCount}件`} className={BADGE_POSITION} />
      ),
    },
  ];

  return (
    <nav
      aria-label="メインメニュー"
      className="mobile-tab-bar fixed inset-x-3.5 bottom-[calc(0.625rem+var(--app-bottom-inset))] z-30 flex h-[66px] items-center rounded-full p-1.5 lg:hidden"
    >
      {tabs.map(({ href, label, Icon, active, badge }) => (
        <Link
          key={href}
          href={href}
          aria-current={active ? "page" : undefined}
          className={cn(
            "relative flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-[0.625rem] text-muted transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent",
            active && "bg-foreground/10 font-medium text-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]",
          )}
        >
          <Icon className="size-[22px]" strokeWidth={1.8} aria-hidden="true" />
          <span className="max-w-full truncate">{label}</span>
          {badge}
        </Link>
      ))}
    </nav>
  );
}
