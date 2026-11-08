"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";

import { cn } from "@/lib/utils";

type CheckResult = {
  status: "checked" | "initialized" | "disabled" | "busy" | "too_soon" | "failed" | "not_owner";
  judged: number;
  needed: number;
  delivered: number;
  partial: boolean;
  failedAccounts: string[];
  message?: string;
};

function describe(result: CheckResult): { text: string; error: boolean } {
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

/** 「いま確認」（#683）。15分ごとの確認と同じ処理（新着の判定 → 必要なら通知）をその場で走らせる。 */
export function MailCheckButton({ className, status }: { className?: string; status?: ReactNode }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function run() {
    setRunning(true);
    setMessage(null);
    try {
      const response = await fetch("/api/mail/check", { method: "POST", cache: "no-store" });
      const data = (await response.json().catch(() => null)) as { result?: CheckResult } | null;
      setMessage(data?.result ? describe(data.result) : { text: "確認に失敗しました。", error: true });
      router.refresh();
    } catch {
      setMessage({ text: "確認に失敗しました（通信できませんでした）。", error: true });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        {status && <span className="text-[0.6875rem] text-muted">{status}</span>}
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[9px] bg-accent px-3.5 py-2 text-xs font-semibold text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          <RefreshCw className={cn("size-3.5", running && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
          {running ? "確認しています…" : "いま確認"}
        </button>
      </div>
      {message && (
        <p
          role={message.error ? "alert" : "status"}
          className={cn(
            "rounded-lg px-3 py-2 text-xs leading-relaxed",
            message.error ? "border border-danger/30 bg-danger-surface text-danger" : "bg-surface text-muted",
          )}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
