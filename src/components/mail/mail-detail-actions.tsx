"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

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
 * 開いた時点で未読なら自動で既読にする（#835）。
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

  // 開いたら自動で既読にする（#835）。開いたメールごとに1回だけ。あとで「未読に戻す」を押しても
  // 再び既読にしない（refの印はこの画面を開いている間だけ持つ）。失敗は赤字で知らせ、再試行はしない
  const autoRead = useRef<string | null>(null);
  useEffect(() => {
    if (!unread || autoRead.current === id) return;
    autoRead.current = id;
    void apply("read", [id], null, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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
