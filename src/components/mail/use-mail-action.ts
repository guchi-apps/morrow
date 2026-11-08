"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { MailAction } from "@/lib/mail/contract";

export type MailActionNotice = { text: string; error: boolean };

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
      const response = await fetch("/api/mail/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ids, labelId }),
      });
      const data = (await response.json().catch(() => null)) as { done?: string; error?: string } | null;
      if (!response.ok) {
        setNotice({ text: `操作できませんでした: ${data?.error ?? `HTTP ${response.status}`}`, error: true });
        return false;
      }
      setNotice({ text: data?.done ?? "操作しました", error: false });
      options.after?.(action);
      router.refresh();
      return true;
    } catch {
      setNotice({ text: "操作できませんでした（通信できませんでした）。", error: true });
      return false;
    } finally {
      setPending(false);
    }
  }

  return { apply, pending, notice };
}
