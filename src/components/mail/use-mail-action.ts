"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { MailAction } from "@/lib/mail/contract";

export type MailActionNotice = { text: string; error: boolean };

type SendResult = { ok: true; done: string } | { ok: false; error: string };

async function send(action: MailAction, ids: string[], labelId: string | null): Promise<SendResult> {
  try {
    const response = await fetch("/api/mail/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ids, labelId }),
    });
    const data = (await response.json().catch(() => null)) as { done?: string; error?: string } | null;
    if (!response.ok) {
      return { ok: false, error: `操作できませんでした: ${data?.error ?? `HTTP ${response.status}`}` };
    }
    return { ok: true, done: data?.done ?? "操作しました" };
  } catch {
    return { ok: false, error: "操作できませんでした（通信できませんでした）。" };
  }
}

/**
 * 整理の操作（#683）を `POST /api/mail/actions` へ送る。成功したら画面を取り直す。
 * 拒否（複数アカウントにまたがる・持ち主でない等）はサーバーが返した理由をそのまま赤で出す。
 */
export function useMailAction(options: { after?: (action: MailAction) => void } = {}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<MailActionNotice | null>(null);

  async function apply(action: MailAction, ids: string[], labelId: string | null = null): Promise<boolean> {
    setPending(true);
    setNotice(null);
    try {
      const result = await send(action, ids, labelId);
      if (!result.ok) {
        setNotice({ text: result.error, error: true });
        return false;
      }
      setNotice({ text: result.done, error: false });
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
  async function archiveRow(id: string, unread: boolean): Promise<boolean> {
    setNotice(null);
    let markedRead = false;
    if (unread) {
      const read = await send("read", [id], null);
      if (!read.ok) {
        setNotice({ text: read.error, error: true });
        return false;
      }
      markedRead = true;
    }
    const archived = await send("archive", [id], null);
    if (!archived.ok) {
      setNotice({ text: markedRead ? `${archived.error}（既読にはしました）` : archived.error, error: true });
      if (markedRead) router.refresh();
      return false;
    }
    setNotice({ text: archived.done, error: false });
    router.refresh();
    return true;
  }

  return { apply, archiveRow, pending, notice };
}
