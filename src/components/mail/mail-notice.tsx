import { cn } from "@/lib/utils";

import type { MailActionNotice } from "./use-mail-action";

/** 操作の結果。拒否は赤い帯で、成功は控えめに出す。 */
export function MailNotice({ notice }: { notice: MailActionNotice | null }) {
  if (!notice) return null;
  return (
    <p
      role={notice.error ? "alert" : "status"}
      className={cn(
        "rounded-[10px] px-3.5 py-2.5 text-xs leading-relaxed",
        notice.error ? "border border-danger/30 bg-danger-surface text-danger" : "border border-border bg-surface text-muted",
      )}
    >
      {notice.text}
    </p>
  );
}
