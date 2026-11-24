"use client";

import { Check, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";

import { SENSITIVE_LABELS, type SensitiveHit } from "@/lib/hermes/skill-core";

/**
 * Hermesが作るもの（スキル #1154・記憶 #1155）の確認カードで共有する部品。
 * 「内容を見て、個人情報が無いことを確かめて、承認か却下を押す」までの形を1か所に持つ。
 */

/** 本文のうち、個人情報らしき文字列を強調して出す。 */
export function Highlighted({ text, hits }: { text: string; hits: SensitiveHit[] }) {
  const needles = hits.map((hit) => hit.text.replace(/…$/, "")).filter((needle) => needle !== "");
  if (needles.length === 0) return <>{text}</>;
  const escaped = needles.map((needle) => needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = text.split(new RegExp(`(${escaped.join("|")})`, "g"));
  return (
    <>
      {parts.map((part, index) =>
        needles.includes(part) ? (
          <mark key={index} className="rounded bg-red-500/25 px-0.5 text-foreground">
            {part}
          </mark>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/** 形式の確認の結果（承認を断る `error` と、見せるだけの `warning`）。 */
export function IssueList({ issues }: { issues: { level: "error" | "warning"; message: string }[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-xs">
      {issues.map((issue, index) => (
        <li key={index} className={issue.level === "error" ? "text-red-500" : "text-muted"}>
          {issue.level === "error" ? "✕ " : "⚠ "}
          {issue.message}
        </li>
      ))}
    </ul>
  );
}

/** 個人情報・認証情報らしき文字列が見つかったときの赤い警告。 */
export function SensitiveWarning({ hits, where = "本文" }: { hits: SensitiveHit[]; where?: string }) {
  if (hits.length === 0) return null;
  return (
    <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-2 text-xs">
      <p className="font-semibold">個人情報・認証情報らしき文字列があります（{where}の赤い部分）</p>
      <ul className="mt-1 list-disc pl-4">
        {hits.map((hit, index) => (
          <li key={index}>
            {SENSITIVE_LABELS[hit.kind]}: <code>{hit.text}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 「個人情報を含んでいないことを確認した」チェックと、承認・却下のボタン。
 * `endpoint` へ `POST { action, confirmed }` を送り、成功したら画面を取り直す。
 */
export function ReviewActions({
  endpoint,
  blocked,
  approveLabel,
  confirmLabel = "住所・口座・認証情報などの個人情報を含んでいないことを確認した",
}: {
  endpoint: string;
  /** 形式の確認に通らず、承認できない。 */
  blocked: boolean;
  approveLabel: string;
  confirmLabel?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approve" | "discard" | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function act(action: "approve" | "discard") {
    setBusy(action);
    setMessage(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, confirmed }),
      });
      if (response.ok) {
        router.refresh();
        return;
      }
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      setMessage(data?.error ?? "処理できませんでした。");
    } catch {
      setMessage("通信できませんでした。もう一度お試しください。");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <label className="flex items-start gap-2 text-xs">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5" />
        <span>{confirmLabel}</span>
      </label>

      {message && (
        <p role="alert" className="text-xs text-red-500">
          {message}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy !== null || blocked || !confirmed}
          onClick={() => void act("approve")}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white disabled:opacity-40"
        >
          {busy === "approve" ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Check className="size-3.5" aria-hidden="true" />}
          {approveLabel}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void act("discard")}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-40"
        >
          {busy === "discard" && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
          却下
        </button>
      </div>
    </>
  );
}
