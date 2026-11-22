"use client";

import { Undo2 } from "lucide-react";
import Link from "next/link";

import { senderName } from "@/lib/mail/contract";

import { MailNotice } from "./mail-notice";
import { useMailAction } from "./use-mail-action";

export type ArchivedItem = {
  id: string;
  /** アーカイブした時刻の表示（日本時間の「14:32」）。 */
  timeLabel: string;
  /** AIDEから本文を取れなかった行は null（件名を出さず、戻すボタンだけ出す）。 */
  from: string | null;
  subject: string | null;
};

export type ArchivedGroup = { label: string; items: ArchivedItem[] };

/** 最近のアーカイブ（#1122）。アーカイブした順に日ごとに並べ、各行から受信トレイへ戻せる。 */
export function ArchivedList({ groups, back }: { groups: ArchivedGroup[]; back: string }) {
  const action = useMailAction();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs leading-relaxed text-muted">
        Morrowでアーカイブしたメールを、アーカイブした順に表示します（直近7日・最大30通）。Gmailなどで直接アーカイブしたものは出ません。
      </p>
      <MailNotice notice={action.notice} />
      {groups.map((group) => (
        <section key={group.label} aria-label={group.label} className="flex flex-col gap-1.5">
          <h2 className="px-0.5 text-xs text-muted">{group.label}</h2>
          <ul className="overflow-hidden rounded-xl border border-border bg-surface">
            {group.items.map((item) => (
              <li key={item.id} className="flex items-center gap-2.5 border-b border-border px-3 py-2.5 last:border-b-0 md:px-3.5">
                <Link href={`/mail/${encodeURIComponent(item.id)}?back=${encodeURIComponent(back)}`} className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate text-[0.8125rem] font-medium">{item.from ? senderName(item.from) : "（取得できませんでした）"}</span>
                  <span className="truncate text-xs text-muted">{item.subject ?? "メールを開いて確かめる"}</span>
                </Link>
                <time className="shrink-0 text-[0.6875rem] text-muted">{item.timeLabel}</time>
                <button
                  type="button"
                  disabled={action.pending}
                  onClick={() => void action.apply("inbox", [item.id])}
                  aria-label={`${item.subject ?? "このメール"}を受信トレイへ戻す`}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-xs hover:bg-rail-active disabled:opacity-50"
                >
                  <Undo2 className="size-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">受信トレイへ戻す</span>
                  <span className="sm:hidden">戻す</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
