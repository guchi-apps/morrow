"use client";

import { useState } from "react";

import type { LearnedRule } from "@/lib/mail/learn-core";

/**
 * メール本文の帯の「今後このようなメールを［知らせる｜知らせない］」（#833）。押すとAIがこのメールから傾向を読み取り
 * （数十秒）、足した・直した傾向を出す。「取り消す」は印を外し、傾向の一覧を押す前へ戻す。
 */
export function MailFeedback({ id, initial }: { id: string; initial: boolean | null }) {
  const [selected, setSelected] = useState<boolean | null>(initial);
  const [pending, setPending] = useState<boolean | null>(null);
  const [learned, setLearned] = useState<{ rule: LearnedRule | null; previous: LearnedRule[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(notify: boolean) {
    if (pending !== null || selected === notify) return;
    setPending(notify);
    setError(null);
    setLearned(null);
    try {
      const response = await fetch("/api/mail/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, notify }),
      });
      const data = (await response.json().catch(() => null)) as
        | { learned?: LearnedRule | null; previous?: LearnedRule[]; error?: string }
        | null;
      if (!response.ok || !Array.isArray(data?.previous)) {
        setError(data?.error ?? "学習できませんでした。");
        return;
      }
      setSelected(notify);
      setLearned({ rule: data.learned ?? null, previous: data.previous });
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
        body: JSON.stringify({ id, restore: learned.previous }),
      });
      if (!response.ok) {
        setError("取り消せませんでした。");
        return;
      }
      setSelected(null);
      setLearned(null);
    } catch {
      setError("取り消せませんでした（通信できませんでした）。");
    }
  }

  const option = (notify: boolean, label: string) => {
    const on = pending === notify || (pending === null && selected === notify);
    return (
      <button
        type="button"
        onClick={() => choose(notify)}
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
          {option(true, "知らせる")}
          {option(false, "知らせない")}
        </div>
        <span className="text-[0.6875rem] text-muted" role="status">
          {pending !== null ? "AIが傾向を読み取っています…（数十秒）" : selected === null ? "押すとAIが傾向を読み取ります" : ""}
        </span>
      </div>
      {learned && (
        <p className="flex items-start justify-between gap-2 rounded-lg bg-fair-surface px-2.5 py-1.5 text-[0.6875rem] leading-relaxed text-fair">
          <span>
            ✓ 学習しました
            {learned.rule ? `：「${learned.rule.text}」は${learned.rule.notify ? "知らせる" : "知らせない"}` : "（傾向は変わりませんでした）"}
          </span>
          <button type="button" onClick={undo} className="shrink-0 text-muted underline">
            取り消す
          </button>
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
