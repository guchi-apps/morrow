import Link from "next/link";

import type { MailAccount } from "@/lib/mail/contract";
import { mailAccountTone } from "@/lib/mail/contract";
import { cn } from "@/lib/utils";

import { ACCOUNT_TONE_CLASS } from "./mail-account-chip";

type Props = {
  accounts: MailAccount[];
  /** 絞り込み中のアカウントの鍵。null は「すべて」。 */
  current: string | null;
  /** 切り替え先のURLを作る（検索語・表示は引き継ぎ、ページ位置とラベルは捨てる）。 */
  hrefFor: (accountKey: string | null) => string;
  /** 取得できなかったアカウントの名前（鍵ではなく表示名）。 */
  failedNames: string[];
};

/** アカウントで絞る（#711）。複数アカウントのときだけ出す。 */
export function MailAccountTabs({ accounts, current, hrefFor, failedNames }: Props) {
  const items: { key: string | null; name: string }[] = [{ key: null, name: "すべて" }, ...accounts];
  return (
    <nav aria-label="アカウント" className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="mr-0.5 text-[0.6875rem] text-muted">アカウント</span>
      {items.map((item) => {
        const on = item.key === current;
        return (
          <Link
            key={item.key ?? "all"}
            href={hrefFor(item.key)}
            aria-current={on ? "page" : undefined}
            className={cn(
              "whitespace-nowrap rounded-full border px-3 py-1.5 transition-colors",
              on ? "border-foreground bg-foreground text-background" : "border-border bg-surface hover:bg-rail-active",
            )}
          >
            {item.key && <i className={cn("mr-1.5 inline-block size-[7px] rounded-full align-[1px]", ACCOUNT_TONE_CLASS[mailAccountTone(item.key)].dot)} />}
            {item.name}
          </Link>
        );
      })}
      {failedNames.length > 0 && <span className="text-[0.6875rem] text-danger">取得できなかったアカウント: {failedNames.join("、")}</span>}
    </nav>
  );
}
