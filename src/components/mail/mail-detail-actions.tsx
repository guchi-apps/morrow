"use client";

import { useRouter } from "next/navigation";
import { Archive, Inbox, Mail, MailOpen } from "lucide-react";
import { useEffect, useRef } from "react";

import { MailBackLink } from "./mail-back-link";
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
 * 開いた時点で未読なら自動で既読にする（#835）。ボタンは画面上端の固定バー（#987。「一覧へ戻る」の右端にアイコンで置く。#970の下部バーから移した）。
 * アーカイブ済みなら右のボタンは「受信トレイに戻す」。
 * スター・ラベル・ゴミ箱は使わないので出さない（サーバー側の操作そのものは一覧・契約のために残してある）。
 */
export function MailDetailActions({ id, unread, inInbox, inTrash, back }: Props) {
  const router = useRouter();
  const { apply, archiveRow, pending, notice } = useMailAction();

  // アーカイブは完了を待たずに一覧へ戻し、裏で流す（#1023）。一覧では記憶（archived-memory）で隠す
  function archiveAndLeave() {
    void archiveRow(id, false, true);
    router.push(back);
  }

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
    "grid size-10 place-items-center rounded-full border border-border bg-surface text-foreground transition-colors hover:bg-rail-active disabled:opacity-50";
  const primary = "!border-accent !bg-accent text-white hover:!bg-accent/90";
  const icon = "size-[18px]";
  const readLabel = unread ? "既読にする" : "未読にする";

  return (
    <>
      <MailBackLink href={back} archived={!inInbox && !inTrash}>
        <button
          type="button"
          disabled={pending}
          onClick={() => apply(unread ? "read" : "unread", [id])}
          className={button}
          aria-label={readLabel}
          title={readLabel}
        >
          {unread ? <MailOpen className={icon} aria-hidden="true" /> : <Mail className={icon} aria-hidden="true" />}
        </button>
        {inInbox ? (
          <button
            type="button"
            disabled={pending}
            onClick={archiveAndLeave}
            className={`${button} ${primary}`}
            aria-label="アーカイブする"
            title="アーカイブする"
          >
            <Archive className={icon} aria-hidden="true" />
          </button>
        ) : (
          !inTrash && (
            <button
              type="button"
              disabled={pending}
              onClick={() => apply("inbox", [id])}
              className={`${button} ${primary}`}
              aria-label="受信トレイに戻す"
              title="受信トレイに戻す"
            >
              <Inbox className={icon} aria-hidden="true" />
            </button>
          )
        )}
      </MailBackLink>
      <MailNotice notice={notice} />
    </>
  );
}
