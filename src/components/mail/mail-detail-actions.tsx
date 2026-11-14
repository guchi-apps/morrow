"use client";

import { useRouter } from "next/navigation";
import { Archive, Inbox, Mail, MailOpen } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { HEADER_ACTIONS_ID } from "@/components/chat/header-actions";
import type { MailAction } from "@/lib/mail/contract";

import { MailNotice } from "./mail-notice";
import { useMailAction } from "./use-mail-action";

const subscribeNothing = () => () => {};
const findSlot = () => document.getElementById(HEADER_ACTIONS_ID);

type Props = {
  id: string;
  unread: boolean;
  inInbox: boolean;
  inTrash: boolean;
  back: string;
};

/**
 * 本文の画面の操作（#683・#717）。既読／未読とアーカイブ（アーカイブ済みなら受信トレイへ戻す）だけ。
 * 開いた時点で未読なら自動で既読にする（#835）。ボタンはヘッダー右上のアイコンに固定する（#883。スクロールしても動かない）。
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

  // ヘッダー右上の置き場（シェルが置く）。マウント後に見つける。無ければ（置き場が無い画面）本文の先頭に出す
  const slot = useSyncExternalStore(subscribeNothing, findSlot, () => null);

  const iconButton =
    "grid size-[34px] place-items-center rounded-[10px] border border-border bg-background transition-colors hover:bg-rail-active disabled:opacity-50";
  const icon = "size-4";
  const readLabel = unread ? "既読にする" : "未読に戻す";
  const buttons = (
    <>
      <button type="button" disabled={pending} onClick={() => apply(unread ? "read" : "unread", [id])} className={iconButton} aria-label={readLabel} title={readLabel}>
        {unread ? <MailOpen className={icon} aria-hidden="true" /> : <Mail className={icon} aria-hidden="true" />}
      </button>
      {inInbox ? (
        <button type="button" disabled={pending} onClick={() => apply("archive", [id])} className={iconButton} aria-label="アーカイブ" title="アーカイブ">
          <Archive className={icon} aria-hidden="true" />
        </button>
      ) : (
        !inTrash && (
          <button type="button" disabled={pending} onClick={() => apply("inbox", [id])} className={iconButton} aria-label="受信トレイへ戻す" title="受信トレイへ戻す">
            <Inbox className={icon} aria-hidden="true" />
          </button>
        )
      )}
    </>
  );

  return (
    <>
      {slot ? createPortal(buttons, slot) : <div className="flex gap-1.5">{buttons}</div>}
      <MailNotice notice={notice} />
    </>
  );
}
