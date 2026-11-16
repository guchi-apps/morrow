"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createPortal } from "react-dom";

import { HEADER_ICON_BUTTON, useHeaderSlot } from "@/components/chat/header-actions";
import { cn } from "@/lib/utils";

export type CheckResult = {
  status: "checked" | "initialized" | "disabled" | "busy" | "too_soon" | "failed" | "not_owner";
  judged: number;
  needed: number;
  delivered: number;
  partial: boolean;
  failedAccounts: string[];
  message?: string;
};

export function describeMailCheck(result: CheckResult): { text: string; error: boolean } {
  switch (result.status) {
    case "checked": {
      const partial = result.partial ? "（一部のアカウントは取得できませんでした）" : "";
      if (result.judged === 0) return { text: `新着はありませんでした${partial}。`, error: result.partial };
      if (result.needed === 0) return { text: `新着${result.judged}通を確認しました。知らせるものはありませんでした${partial}。`, error: result.partial };
      const sent = result.delivered > 0 ? "通知でお知らせしました" : "通知を届けられる端末がありませんでした";
      return { text: `新着${result.judged}通のうち${result.needed}通が必要と判定し、${sent}${partial}。`, error: result.partial };
    }
    case "initialized":
      return { text: "確認を始めました。これより後に届いたメールから判定します。", error: false };
    case "disabled":
      return { text: "通知の種類「必要なメール」がオフのため、判定していません（設定の「通知の種類」で切り替えられます）。", error: false };
    case "busy":
      return { text: "いま確認しています。終わるまでお待ちください。", error: false };
    case "too_soon":
      return { text: "続けての確認は1分あけてください。", error: false };
    case "not_owner":
      return { text: "このメールボックスの持ち主ではないため、確認できません。", error: true };
    case "failed":
      return { text: result.message ?? "確認に失敗しました。", error: true };
  }
}

/**
 * 「いま確認」（#683）。15分ごとの確認と同じ処理（新着の判定 → 必要なら通知）をその場で走らせる。
 * ボタンはヘッダー右上のアイコン（#951。置き場が無い画面ではその場に出す）。結果のメッセージは本文の先頭に出す。
 */
export function MailCheckButton({ className }: { className?: string }) {
  const router = useRouter();
  const slot = useHeaderSlot();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function run() {
    setRunning(true);
    setMessage(null);
    try {
      const response = await fetch("/api/mail/check", { method: "POST", cache: "no-store" });
      const data = (await response.json().catch(() => null)) as { result?: CheckResult } | null;
      setMessage(data?.result ? describeMailCheck(data.result) : { text: "確認に失敗しました。", error: true });
      router.refresh();
    } catch {
      setMessage({ text: "確認に失敗しました（通信できませんでした）。", error: true });
    } finally {
      setRunning(false);
    }
  }

  const label = running ? "確認しています…" : "いま確認";
  const button = (
    <button
      type="button"
      onClick={run}
      disabled={running}
      aria-label={label}
      title={label}
      className={cn(HEADER_ICON_BUTTON, "border-accent bg-accent text-accent-foreground hover:bg-accent hover:opacity-90 disabled:opacity-60")}
    >
      <RefreshCw className={cn("size-4", running && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
    </button>
  );

  return (
    <>
      {slot ? createPortal(button, slot) : button}
      {message && (
        <p
          role={message.error ? "alert" : "status"}
          className={cn(
            "rounded-lg px-3 py-2 text-xs leading-relaxed",
            message.error ? "border border-danger/30 bg-danger-surface text-danger" : "bg-surface text-muted",
            className,
          )}
        >
          {message.text}
        </p>
      )}
    </>
  );
}
