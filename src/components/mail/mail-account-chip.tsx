import { mailAccountTone, type MailAccountTone } from "@/lib/mail/contract";
import { cn } from "@/lib/utils";

/**
 * アカウントの色。鍵だけで決まる（`mailAccountTone()`）ので、名前を変えても色は変わらない。
 * `dot` は未読の塗り、`ring` は既読の輪（同じ色の線。#789。透明度で薄めると色の区別が消えるため）。
 */
export const ACCOUNT_TONE_CLASS: Record<MailAccountTone, { chip: string; dot: string; ring: string }> = {
  coral: { chip: "bg-account-coral-surface text-account-coral-text", dot: "bg-account-coral", ring: "border-account-coral" },
  blue: { chip: "bg-account-blue-surface text-account-blue-text", dot: "bg-account-blue", ring: "border-account-blue" },
  teal: { chip: "bg-account-teal-surface text-account-teal-text", dot: "bg-account-teal", ring: "border-account-teal" },
  violet: { chip: "bg-account-violet-surface text-account-violet-text", dot: "bg-account-violet", ring: "border-account-violet" },
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
