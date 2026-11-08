"use client";

import { useRouter } from "next/navigation";

import type { MailAction } from "@/lib/mail/contract";

import { MailNotice } from "./mail-notice";
import { useMailAction } from "./use-mail-action";

type Props = {
  id: string;
  unread: boolean;
  inInbox: boolean;
  inTrash: boolean;
  back: string;
};

/**
 * 本文の画面の操作（#683・#717）。既読／未読とアーカイブ（アーカイブ済みなら受信トレイへ戻す）だけ。
 * スター・ラベル・ゴミ箱は使わないので出さない（サーバー側の操作そのものは一覧・契約のために残してある）。
 */
export function MailDetailActions({ id, unread, inInbox, inTrash, back }: Props) {
  const router = useRouter();
  const leaves = new Set<MailAction>(["archive"]);
  const { apply, pending, notice } = useMailAction({
    after: (action) => {
      if (leaves.has(action)) router.push(back);
    },
  });

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
      </div>
      <MailNotice notice={notice} />
    </div>
  );
}
