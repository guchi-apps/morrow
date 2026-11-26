"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { forgetArchived, rememberArchived } from "@/lib/mail/archived-memory";
import type { MailAction } from "@/lib/mail/contract";

import { createPendingCounter, createRefreshGate } from "./action-queue";
import {
  pendingArchives,
  readBackgroundFailure,
  send,
  sendArchive,
  setBackgroundFailure,
  subscribeBackgroundFailure,
  type MailActionNotice,
} from "./archive-sender";

export type { MailActionNotice };

// 画面で1本だけ持つ、結果待ちの件数と取り直しの判定（#767）
const archiving = createPendingCounter();
const refreshGate = createRefreshGate();

/**
 * 整理の操作（#683）を `POST /api/mail/actions` へ送る。成功したら画面を取り直す。
 * 拒否（複数アカウントにまたがる・持ち主でない等）はサーバーが返した理由をそのまま赤で出す。
 * アーカイブは画面を閉じても進むようサーバーの列で実行する（#1192。`archive-sender.ts`）。
 */
export function useMailAction(options: { after?: (action: MailAction) => void } = {}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<MailActionNotice | null>(null);
  const [queued, setQueued] = useState(archiving.pending());
  useEffect(() => archiving.subscribe(setQueued), []);
  const [shared, setShared] = useState<MailActionNotice | null>(readBackgroundFailure());
  useEffect(() => {
    const sync = () => setShared(readBackgroundFailure());
    sync();
    return subscribeBackgroundFailure(sync);
  }, []);

  async function apply(
    action: MailAction,
    ids: string[],
    labelId: string | null = null,
    // 自動の既読（#835）など、利用者が押していない操作では成功の表示を出さない（失敗は出す）
    quiet = false,
  ): Promise<boolean> {
    setPending(true);
    setNotice(null);
    setBackgroundFailure(null);
    try {
      // 受信トレイへ戻す・ゴミ箱へ移すメールは、確かめ直しで後からアーカイブしない
      if (action === "inbox" || action === "trash") pendingArchives.dropIds(ids);
      const result = action === "archive" ? await sendArchive(ids, false) : await send(action, ids, labelId);
      if (!result.ok) {
        setNotice({ text: result.error, error: true });
        return false;
      }
      if (action === "archive") rememberArchived(ids);
      else if (action === "inbox") forgetArchived(ids);
      if (!quiet) setNotice({ text: result.done, error: false });
      options.after?.(action);
      router.refresh();
      return true;
    } finally {
      setPending(false);
    }
  }

  /**
   * スワイプでのアーカイブ（#715）。未読なら先に既読にしてからアーカイブする。
   * 既読が通ってアーカイブが失敗した場合は、既読のまま残ることを赤字で知らせる。
   */
  async function archiveRow(id: string, unread: boolean, optimistic = false): Promise<boolean> {
    setNotice(null);
    // 本文の画面から押した回（#1023）: 完了を待たずに一覧から隠し、失敗したら戻して一覧側の赤い帯で知らせる
    if (optimistic) rememberArchived([id]);
    const fail = (text: string): false => {
      if (optimistic) {
        forgetArchived([id]);
        setBackgroundFailure({ text, error: true });
      } else {
        setNotice({ text, error: true });
      }
      return false;
    };
    // 順番を待たずにすぐ送る（順番はサーバーが守る）。未読の既読化も同じ1件で行う
    archiving.start();
    try {
      const archived = await sendArchive([id], unread);
      if (!archived.ok) {
        if (archived.markedRead) refreshGate.markSucceeded();
        return fail(archived.error);
      }
      refreshGate.markSucceeded();
      rememberArchived([id]);
      if (!optimistic) setNotice({ text: archived.done, error: false });
      return true;
    } finally {
      // 取り直しは結果待ちが無くなる最後の1回だけ（途中で取り直すとAIDEへの要求が重なる）。
      // 最後の1通が失敗しても、先に成功した分を一覧へ反映する
      if (refreshGate.shouldRefresh(archiving.pending())) router.refresh();
      archiving.finish();
    }
  }

  return { apply, archiveRow, pending, notice: notice ?? shared, queued };
}
