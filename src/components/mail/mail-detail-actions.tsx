"use client";

import { useRouter } from "next/navigation";

import type { MailAction, MailLabel } from "@/lib/mail/contract";

import { MailNotice } from "./mail-notice";
import { useMailAction } from "./use-mail-action";

type Props = {
  id: string;
  unread: boolean;
  starred: boolean;
  inInbox: boolean;
  inTrash: boolean;
  labelIds: string[];
  labels: MailLabel[];
  supportsLabels: boolean;
  back: string;
};

/** 本文の画面の操作（#683）。アーカイブ・ゴミ箱は一覧へ戻る。 */
export function MailDetailActions({ id, unread, starred, inInbox, inTrash, labelIds, labels, supportsLabels, back }: Props) {
  const router = useRouter();
  const leaves = new Set<MailAction>(["archive", "trash"]);
  const { apply, pending, notice } = useMailAction({
    after: (action) => {
      if (leaves.has(action)) router.push(back);
    },
  });
  const userLabels = labels.filter((label) => label.type === "user");
  const attached = userLabels.filter((label) => labelIds.includes(label.id));
  const attachable = userLabels.filter((label) => !labelIds.includes(label.id));

  const button =
    "rounded-[9px] border border-border bg-surface px-3 py-1.5 text-xs transition-colors hover:bg-rail-active disabled:opacity-50";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        <button type="button" disabled={pending} onClick={() => apply(unread ? "read" : "unread", [id])} className={button}>
          {unread ? "既読にする" : "未読に戻す"}
        </button>
        {inInbox ? (
          <button type="button" disabled={pending} onClick={() => apply("archive", [id])} className={button}>
            アーカイブ
          </button>
        ) : (
          !inTrash && (
            <button type="button" disabled={pending} onClick={() => apply("inbox", [id])} className={button}>
              受信トレイへ戻す
            </button>
          )
        )}
        <button type="button" disabled={pending} onClick={() => apply(starred ? "unstar" : "star", [id])} className={button}>
          {starred ? "★ スターを外す" : "☆ スター"}
        </button>
        {supportsLabels && attachable.length > 0 && (
          <select
            aria-label="ラベルを付ける"
            disabled={pending}
            value=""
            onChange={(event) => event.target.value && apply("label-add", [id], event.target.value)}
            className={button}
          >
            <option value="">ラベル…</option>
            {attachable.map((label) => (
              <option key={label.id} value={label.id}>
                {label.name}
              </option>
            ))}
          </select>
        )}
        {inTrash ? (
          <button type="button" disabled={pending} onClick={() => apply("untrash", [id])} className={button}>
            ゴミ箱から戻す
          </button>
        ) : (
          <button type="button" disabled={pending} onClick={() => apply("trash", [id])} className={button}>
            ゴミ箱へ
          </button>
        )}
      </div>
      {supportsLabels && attached.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[0.6875rem] text-muted">
          ラベル:
          {attached.map((label) => (
            <button
              key={label.id}
              type="button"
              disabled={pending}
              onClick={() => apply("label-remove", [id], label.id)}
              className="rounded-full bg-topic-surface px-2 py-0.5 font-bold text-topic"
              aria-label={`ラベル「${label.name}」を外す`}
            >
              {label.name} ×
            </button>
          ))}
        </div>
      )}
      <MailNotice notice={notice} />
    </div>
  );
}
