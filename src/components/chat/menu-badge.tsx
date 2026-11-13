import { cn } from "@/lib/utils";

import { badgeText } from "./badge-text";

/**
 * メニュー項目の右端に出す件数バッジ（#877）。アプリカラーの丸で、チャット・メール・ニュースで揃える。
 * 0件のときは何も出さない。
 */
export function MenuBadge({ count, more = false, label, className }: { count: number; more?: boolean; label: string; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "tabular-nums min-w-5 rounded-full bg-accent px-1.5 text-center text-[0.6875rem] font-semibold leading-5 text-accent-foreground",
        className,
      )}
      aria-label={label}
    >
      {badgeText(count, more)}
    </span>
  );
}
