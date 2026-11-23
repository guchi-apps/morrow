"use client";

import { Check, CircleAlert, Loader2 } from "lucide-react";
import { useState } from "react";

import { ProposalCard } from "@/components/hermes/proposal-card";
import { splitLinks } from "@/lib/hermes/linkify";
import type { ProposalView } from "@/lib/hermes/proposal-core";
import type { ChatItem } from "@/lib/hermes/stream-view";

/** チャットの並びの1要素（#794）。吹き出し・道具のチップ・結果カード・確認カード・Hermesの承認・質問・お知らせ。 */

type Props = {
  item: ChatItem;
  /** 実行中のターン。Hermesの承認の宛先。 */
  turnId: string | null;
  onApproval: (requestId: string, choice: "once" | "deny") => void;
  onProposalChange: (proposal: ProposalView) => void;
  /** 失敗したターンの再送（#1158）。押せるのは最後の失敗通知で、実行中でないときだけ渡る。無ければボタンを出さない。 */
  onRetry?: (retry: { text: string; risky: boolean }) => void;
  /** 道具の経過秒の基準になる現在時刻（1秒ごとに更新される。#1158）。 */
  now: number;
};

export function ChatItemView({ item, turnId, onApproval, onProposalChange, onRetry, now }: Props) {
  switch (item.kind) {
    case "user":
      return (
        <div className="max-w-[85%] self-end whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-accent px-3.5 py-2 text-sm text-white">
          {item.text}
        </div>
      );

    case "assistant":
      return (
        <div className="max-w-[88%] self-start whitespace-pre-wrap break-words rounded-2xl rounded-bl-sm border border-border bg-surface px-3.5 py-2 text-sm">
          <LinkedText text={item.text} />
          {!item.done &&<span className="ml-0.5 inline-block animate-pulse text-muted" aria-hidden="true">▍</span>}
        </div>
      );

    case "tool":
      if (item.auto && item.status !== "running") {
        // 取り消せる書き込み（自動実行済み）の結果カード。値はこの画面にだけ出し、Morrowには残さない
        return (
          <section
            className={`max-w-[560px] self-start rounded-xl border border-border border-l-4 bg-surface p-3 text-sm ${item.status === "failed" ? "border-l-red-600" : item.status === "unknown" ? "border-l-amber-500" : "border-l-accent"}`}
          >
            <div className="flex flex-wrap items-center gap-2 font-semibold">
              <span>{item.label}</span>
              <span
                className={`rounded-full px-2 py-px text-xs font-normal ${item.status === "failed" ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" : item.status === "unknown" ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300" : "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"}`}
              >
                {item.status === "failed" ? "失敗しました" : item.status === "unknown" ? "結果を確認できません" : "自動で実行しました"}
              </span>
            </div>
            {item.status === "unknown" && (
              <p className="mt-1.5 text-xs text-muted">
                途中で止まったため、実行されたか分かりません。予定・タスクの画面で確かめてから、無ければ改めて頼んでください（確かめずに頼み直すと重複することがあります）。
              </p>
            )}
            {item.status === "failed" && item.result?.failure && (
              <p className="mt-1.5 text-xs text-red-700 dark:text-red-300">理由: {item.result.failure}。実行されていない可能性が高いです。</p>
            )}
            {item.status === "done" && item.result?.url && (
              <p className="mt-1.5 text-xs">
                <a href={item.result.url} target="_blank" rel="noopener noreferrer" className="text-accent underline">
                  {item.result.number ? `#${item.result.number} を開く` : "作成したものを開く"}
                </a>
              </p>
            )}
            {item.lines.length > 0 && (
              <dl className="mt-1.5 grid grid-cols-[6em_1fr] gap-x-2.5 gap-y-0.5">
                {item.lines.map((line) => (
                  <div key={line.label} className="contents">
                    <dt className="text-xs text-muted">{line.label}</dt>
                    <dd className="break-all">{line.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        );
      }
      return (
        <div
          className={`inline-flex max-w-full items-center gap-1 self-start rounded-full border px-2.5 py-0.5 text-xs ${item.status === "running" ? "border-amber-400 text-amber-800 dark:text-amber-300" : item.status === "failed" ? "border-red-400 text-red-700" : item.status === "unknown" ? "border-amber-400 text-amber-800 dark:text-amber-300" : "border-border text-muted"}`}
        >
          {item.status === "running" ? (
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          ) : item.status === "failed" || item.status === "unknown" ? (
            <CircleAlert className="size-3" aria-hidden="true" />
          ) : (
            <Check className="size-3" aria-hidden="true" />
          )}
          <span className="truncate">{item.status === "running" ? `${item.label}…` : item.status === "unknown" ? `${item.label}（結果不明）` : item.label}</span>
          {item.hint && <span className="min-w-0 truncate text-muted/70">{item.hint}</span>}
          {item.status === "running" && item.startedAt ? (
            <span className="shrink-0 tabular-nums">{elapsedText(now - item.startedAt)}</span>
          ) : typeof item.durationSeconds === "number" && item.durationSeconds >= 1 ? (
            <span className="shrink-0 tabular-nums text-muted/70">{Math.round(item.durationSeconds)}秒</span>
          ) : null}
        </div>
      );

    case "proposal":
      return <ProposalCard proposal={item.proposal} onChange={onProposalChange} />;

    case "approval":
      return <ApprovalCard item={item} turnId={turnId} onApproval={onApproval} />;

    case "clarify":
      return (
        <div className="max-w-[88%] self-start whitespace-pre-wrap break-words rounded-2xl rounded-bl-sm border border-border bg-surface px-3.5 py-2 text-sm">
          <LinkedText text={item.text} />
        </div>
      );

    case "notice":
      return (
        <div className="flex flex-col items-center gap-1.5 self-center">
          <p
            role={item.tone === "error" ? "alert" : undefined}
            className={`text-center text-xs ${item.tone === "error" ? "text-red-700 dark:text-red-400" : "text-muted"}`}
          >
            {item.text}
          </p>
          {item.retry && onRetry && (
            <>
              {item.retry.risky && (
                <p className="max-w-[420px] text-center text-xs text-muted">
                  途中まで実行された可能性があります。予定・タスクなどの画面で結果を確かめてから、必要なら入力欄で送り直してください（確かめずに送ると重複することがあります）。
                </p>
              )}
              <button
                type="button"
                onClick={() => item.retry && onRetry(item.retry)}
                className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-foreground hover:bg-rail-active"
              >
                {item.retry.risky ? "指示を入力欄へ戻す" : "もう一度送る"}
              </button>
            </>
          )}
        </div>
      );

    case "usage":
      return <p className="self-start text-[11px] tabular-nums text-muted/70">{item.text}</p>;
  }
}

/** 経過のミリ秒を「N秒」「M分N秒」にする。 */
export function elapsedText(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60 ? `${seconds}秒` : `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
}

/** 返信の本文。http(s)のURLだけ押せるリンクにする（#810）。HTMLは組み立てずReact要素で描く。 */
function LinkedText({ text }: { text: string }) {
  return (
    <>
      {splitLinks(text).map((part, index) =>
        part.type === "link" ? (
          <a
            key={index}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-accent underline underline-offset-2"
          >
            {part.text}
          </a>
        ) : (
          part.text
        ),
      )}
    </>
  );
}

/** Hermes自身の承認（通常は来ない）。出すのは「1回だけ許可」と「拒否」だけで、「常に許可」は出さない。 */
function ApprovalCard({
  item,
  turnId,
  onApproval,
}: {
  item: Extract<ChatItem, { kind: "approval" }>;
  turnId: string | null;
  onApproval: (requestId: string, choice: "once" | "deny") => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function answer(choice: "once" | "deny") {
    if (!turnId) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/hermes/turns/${encodeURIComponent(turnId)}/approval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: item.requestId, choice }),
      });
      if (response.ok) onApproval(item.requestId, choice);
      else setError(((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? "回答できませんでした。");
    } catch {
      setError("通信できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="max-w-[560px] self-start rounded-xl border border-border border-l-4 border-l-amber-500 bg-surface p-3.5 text-sm">
      <div className="flex flex-wrap items-center gap-2 font-semibold">
        <span>Hermesが許可を求めています</span>
        {item.status !== "waiting" && (
          <span className="rounded-full bg-border px-2 py-px text-xs font-normal text-muted">
            {item.status === "once" ? "許可しました（1回だけ）" : "拒否しました"}
          </span>
        )}
      </div>
      {item.description && <p className="mt-1 text-xs text-muted">{item.description}</p>}
      {item.command && <pre className="mt-2 overflow-x-auto rounded-lg bg-background px-2.5 py-2 text-xs">{item.command}</pre>}
      {error && (
        <p className="mt-2 text-xs text-red-700" role="alert">
          {error}
        </p>
      )}
      {item.status === "waiting" && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button type="button" disabled={busy || !turnId} onClick={() => answer("once")} className="rounded-lg bg-accent px-4 py-2 text-white disabled:opacity-45">
            1回だけ許可
          </button>
          <button type="button" disabled={busy || !turnId} onClick={() => answer("deny")} className="rounded-lg border border-border px-4 py-2 disabled:opacity-45">
            拒否
          </button>
        </div>
      )}
    </section>
  );
}
