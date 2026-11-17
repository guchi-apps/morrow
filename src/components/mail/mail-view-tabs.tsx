"use client";

import Link from "next/link";
import { createContext, useContext } from "react";

import { cn } from "@/lib/utils";

/**
 * 表示切替（受信トレイ・未読・すべて・ゴミ箱）で「いま押した」チップの共有（#1053）。
 * 同じ画面の `?view=` 違いへの遷移では `loading.tsx` が出ず、サーバーの一覧が届くまで旧画面が残る。
 * そのあいだ押したチップを選択状態にし、一覧をスケルトンへ替えるために `MailSearch` が値を持つ。
 * 新しい `view` で描き直されると（`MailSearch` の `key` が変わる）押下中の状態は消える。
 */
export const MailViewPendingContext = createContext<{ pending: string | null; setPending: (key: string | null) => void }>({
  pending: null,
  setPending: () => undefined,
});

export type MailViewTabItem = { key: string; label: string; href: string };

export function MailViewTabs({ view, items }: { view: string; items: MailViewTabItem[] }) {
  const { pending, setPending } = useContext(MailViewPendingContext);
  // 押した直後は押したチップを選択状態に見せる
  const shown = pending ?? view;
  return (
    <nav aria-label="表示するメール" className="flex shrink-0 flex-nowrap gap-1 text-xs sm:gap-1.5">
      {items.map((item) => {
        const on = item.key === shown;
        const loading = pending !== null && pending !== view && item.key === pending;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={on ? "page" : undefined}
            aria-busy={loading || undefined}
            onClick={(event) => {
              // 別タブで開く操作などは遷移しないので、押下中にしない
              if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              setPending(item.key === view ? null : item.key);
            }}
            className={cn(
              "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1.5 transition-colors sm:px-3",
              on ? "border-foreground bg-foreground text-background" : "border-border bg-surface hover:bg-rail-active",
            )}
          >
            {item.label}
            {loading && (
              <span aria-hidden className="size-3 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
