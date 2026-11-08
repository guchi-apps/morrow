import { mailAccountTone, type MailAccountTone } from "@/lib/mail/contract";
import { cn } from "@/lib/utils";

/** アカウントの色。鍵だけで決まる（`mailAccountTone()`）ので、名前を変えても色は変わらない。 */
export const ACCOUNT_TONE_CLASS: Record<MailAccountTone, { chip: string; dot: string }> = {
  gray: { chip: "bg-rail-active text-muted", dot: "bg-muted" },
  blue: { chip: "bg-topic-surface text-topic", dot: "bg-topic" },
  green: { chip: "bg-fair-surface text-fair", dot: "bg-fair" },
  rose: { chip: "bg-accent-surface text-accent", dot: "bg-accent" },
};

/** どのアカウントのメールか（一覧の行・本文の見出し）。 */
export function MailAccountChip({ accountKey, name, className }: { accountKey: string; name: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-block rounded-full px-1.5 py-px align-[1px] text-[0.65625rem] font-bold",
        ACCOUNT_TONE_CLASS[mailAccountTone(accountKey)].chip,
        className,
      )}
    >
      {name}
    </span>
  );
}
