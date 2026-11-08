"use client";

import { useState } from "react";

import type { MailSummary as Summary } from "@/lib/mail/summary-core";

/**
 * メールの要約（#717）。「要約する」で本文をAIに読ませ、要約と要点をその場に出す（保存しない）。
 * 型だけをimportする（`summary-core.ts` の値は読み込まない）。
 */
export function MailSummary({ id }: { id: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Summary | null>(null);

  async function summarize() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/mail/flow/summary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = (await response.json().catch(() => null)) as (Summary & { error?: string }) | null;
      if (!response.ok || !data) {
        setError(data?.error ?? `要約を作れませんでした（HTTP ${response.status}）。`);
        return;
      }
      setResult({ summary: data.summary, points: data.points });
    } catch {
      setError("要約を作れませんでした（通信できませんでした）。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2.5">
      <button
        type="button"
        onClick={summarize}
        disabled={loading}
        className="rounded-[9px] border border-border bg-surface px-3 py-1.5 text-xs font-bold transition-colors hover:bg-rail-active disabled:opacity-50"
      >
        {loading ? "要約しています…" : result ? "📝 もう一度要約する" : "📝 要約する"}
      </button>

      {error && (
        <p role="alert" className="w-full rounded-[10px] border border-danger/30 bg-danger-surface px-3.5 py-2.5 text-xs leading-relaxed text-danger">
          {error}
        </p>
      )}

      {result && (
        <section aria-label="AIによる要約" className="w-full rounded-xl border border-border bg-surface px-3.5 py-3 text-xs leading-relaxed">
          <p className="mb-1 text-[0.6875rem] text-muted">AIによる要約（本文を読んで作成。外れることがあります）</p>
          <p>{result.summary}</p>
          {result.points.length > 0 && (
            <ul className="mt-1.5 list-disc pl-4">
              {result.points.map((point, index) => (
                <li key={index}>{point}</li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
