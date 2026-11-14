import Link from "next/link";

import type { MailAccount } from "@/lib/mail/contract";
import { mailAccountTone } from "@/lib/mail/contract";
import { cn } from "@/lib/utils";

import { ACCOUNT_TONE_CLASS } from "./mail-account-chip";

type Props = {
  accounts: MailAccount[];
  /** いま表示しているアカウントの鍵（複数選択。#829）。 */
  selected: string[];
  /** そのチップを押した後の一覧のURL（検索語・表示は引き継ぎ、ページ位置とラベルは捨てる）。 */
  hrefFor: (accountKey: string) => string;
  /** 取得できなかったアカウントの名前（鍵ではなく表示名）。 */
  failedNames: string[];
};

/**
 * アカウントで絞る（#711・#829）。複数アカウントのときだけ出す。各チップは独立したオン／オフで、
 * 最後の1つはオフにできない（押しても同じ画面）。
 */
export function MailAccountTabs({ accounts, selected, hrefFor, failedNames }: Props) {
  return (
    <nav aria-label="アカウント" className="flex flex-nowrap items-center gap-1 overflow-x-auto text-[0.6875rem] [scrollbar-width:none] sm:gap-1.5 sm:text-xs [&::-webkit-scrollbar]:hidden">
      <span className="mr-0.5 shrink-0 whitespace-nowrap text-[0.625rem] text-muted sm:text-[0.6875rem]">アカウント</span>
      {accounts.map((item) => {
        const on = selected.includes(item.key);
        const onlyOne = on && selected.length === 1;
        const tone = ACCOUNT_TONE_CLASS[mailAccountTone(item.key)];
        return (
          <Link
            key={item.key}
            href={hrefFor(item.key)}
            aria-pressed={on}
            aria-disabled={onlyOne ? true : undefined}
            className={cn(
              "shrink-0 whitespace-nowrap rounded-full border px-2 py-1 transition-colors sm:px-3 sm:py-1.5",
              on ? tone.selected : "border-border bg-surface hover:bg-rail-active",
            )}
          >
            {on ? (
              <span aria-hidden="true" className="mr-1">
                ✓
              </span>
            ) : (
              <i className={cn("mr-1 inline-block size-[8px] rounded-full border-2 align-[1px] sm:mr-1.5", tone.ring)} />
            )}
            {item.name}
          </Link>
        );
      })}
      {failedNames.length > 0 && <span className="shrink-0 whitespace-nowrap text-[0.6875rem] text-danger">取得できなかったアカウント: {failedNames.join("、")}</span>}
    </nav>
  );
}
