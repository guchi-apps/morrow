"use client";

import { useState } from "react";

import type { LearnChange, LearnedRule } from "@/lib/mail/learn-core";

/**
 * メール本文の帯の「今後このようなメールを［知らせる｜知らせない］」（#833）。押すとAIがこのメールから傾向を読み取り
 * （数十秒）、足した・直した傾向を出す。「取り消す」は印を外し、学習が足した・消した傾向だけを戻す（#847。
 * その後に別の画面で変えた傾向には触れない）。
 */
export type FeedbackChoice = "notify" | "silent" | "archive";

export function MailFeedback({
  id,
  initial,
  unsubscribeUrl,
}: {
  id: string;
  initial: FeedbackChoice | null;
  /** 本文から見つけた購読解除ページ（https のみ。無ければ null）。開くだけで自動では押さない（#942）。 */
  unsubscribeUrl: string | null;
}) {
  const [selected, setSelected] = useState<FeedbackChoice | null>(initial);
  const [pending, setPending] = useState<FeedbackChoice | null>(null);
  const [learned, setLearned] = useState<{ rule: LearnedRule | null; change: LearnChange } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(choice: FeedbackChoice) {
    if (pending !== null || selected === choice) return;
    setPending(choice);
    setError(null);
    setLearned(null);
    try {
      const response = await fetch("/api/mail/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(choice === "notify" ? { id, notify: true } : choice === "archive" ? { id, notify: false, archive: true } : { id, notify: false }),
      });
      const data = (await response.json().catch(() => null)) as
        | { learned?: LearnedRule | null; change?: LearnChange; error?: string }
        | null;
      if (!response.ok || !data?.change || !Array.isArray(data.change.removed) || !Array.isArray(data.change.added)) {
        setError(data?.error ?? "学習できませんでした。");
        return;
      }
      setSelected(choice);
      setLearned({ rule: data.learned ?? null, change: data.change });
    } catch {
      setError("学習できませんでした（通信できませんでした）。");
    } finally {
      setPending(null);
    }
  }

  async function undo() {
    if (!learned) return;
    setError(null);
    try {
      const response = await fetch("/api/mail/feedback", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, revert: learned.change }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "取り消せませんでした。");
        return;
      }
      setSelected(null);
      setLearned(null);
    } catch {
      setError("取り消せませんでした（通信できませんでした）。");
    }
  }

  const option = (choice: FeedbackChoice, label: string) => {
    const on = pending === choice || (pending === null && selected === choice);
    return (
      <button
        type="button"
        onClick={() => choose(choice)}
        disabled={pending !== null}
        aria-pressed={on}
        className={
          "px-3 py-1 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent disabled:cursor-wait " +
          (on ? "bg-foreground font-bold text-background" : "text-foreground hover:bg-border/40")
        }
      >
        {label}
      </button>
    );
  };

  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-foreground/10 pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[0.6875rem] text-muted">今後このようなメールを</span>
        <div role="group" aria-label="今後このようなメールを" className="inline-flex overflow-hidden rounded-full border border-border bg-surface">
          {option("notify", "知らせる")}
          {option("silent", "知らせない")}
          {option("archive", "アーカイブする")}
        </div>
        <span className="text-[0.6875rem] text-muted" role="status">
          {pending !== null ? "AIが傾向を読み取っています…（数十秒）" : selected === null ? "押すとAIが傾向を読み取ります" : ""}
        </span>
      </div>
      {learned && (
        <p className="flex items-start justify-between gap-2 rounded-lg bg-fair-surface px-2.5 py-1.5 text-[0.6875rem] leading-relaxed text-fair">
          <span>
            ✓ 学習しました
            {learned.rule ? `：「${learned.rule.text}」は${learned.rule.notify ? "知らせる" : learned.rule.archive ? "届いたらアーカイブする" : "知らせない"}` : "（傾向は変わりませんでした）"}
          </span>
          <button type="button" onClick={undo} className="shrink-0 text-muted underline">
            取り消す
          </button>
        </p>
      )}
      {unsubscribeUrl && (
        <p className="text-[0.6875rem] leading-relaxed text-muted">
          今後届かないようにするには、送信元のサイトで購読を解除します。
          <a href={unsubscribeUrl} target="_blank" rel="noopener noreferrer nofollow" className="ml-1 text-accent underline">
            購読解除ページを開く ↗
          </a>
        </p>
      )}
      {error && (
        <p role="alert" className="text-[0.6875rem] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
