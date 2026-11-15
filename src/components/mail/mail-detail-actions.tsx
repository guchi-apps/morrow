"use client";

import { useRouter } from "next/navigation";
import { Archive, Inbox, Mail, MailOpen } from "lucide-react";
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
 * 開いた時点で未読なら自動で既読にする（#835）。ボタンは画面下の固定バー（スマホは下部タブバーの真上。#970。親指で押しやすい）。
 * アーカイブ済みなら右のボタンは「受信トレイに戻す」。
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
    "flex h-[46px] flex-1 items-center justify-center gap-1.5 rounded-full border border-border bg-surface/85 text-sm font-semibold shadow-[0_6px_18px_rgba(0,0,0,0.14)] backdrop-blur-md transition-colors hover:bg-rail-active disabled:opacity-50";
  const primary = "!border-accent !bg-accent text-white hover:!bg-accent/90";
  const icon = "size-[18px]";
  const readLabel = unread ? "既読にする" : "未読にする";

  return (
    <>
      <div className="mail-action-bar pointer-events-none fixed z-20 flex justify-center">
        <div className="pointer-events-auto flex w-full max-w-[420px] gap-2">
          <button type="button" disabled={pending} onClick={() => apply(unread ? "read" : "unread", [id])} className={button}>
            {unread ? <MailOpen className={icon} aria-hidden="true" /> : <Mail className={icon} aria-hidden="true" />}
            {readLabel}
          </button>
          {inInbox ? (
            <button type="button" disabled={pending} onClick={() => apply("archive", [id])} className={`${button} ${primary}`}>
              <Archive className={icon} aria-hidden="true" />
              アーカイブする
            </button>
          ) : (
            !inTrash && (
              <button type="button" disabled={pending} onClick={() => apply("inbox", [id])} className={`${button} ${primary}`}>
                <Inbox className={icon} aria-hidden="true" />
                受信トレイに戻す
              </button>
            )
          )}
        </div>
      </div>
      <MailNotice notice={notice} />
    </>
  );
}
