"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { FlowRowButton } from "@/components/mail/flow-row";
import { MailChat } from "@/components/mail/mail-chat";
import { useFlowCards, type FlowRow } from "@/components/mail/use-flow-cards";
import type { MailAnalysis as Analysis } from "@/lib/mail/analyze-core";

/**
 * メールのAI分析（#766）。開いた時点で自動で要約と処理の提案を取り（`POST /api/mail/flow/analyze`。Codexは1回）、
 * 1枚のカードに並べる。提案の行には入力欄を出さず、押すとハーフモーダル（`FlowSheet`）が開く。
 * 以前の「📝 要約する」（#717）と「✨ このメールをどうする？」（#689）の2つのボタンを置き換えた。
 * カードの末尾に、本文への指示（#784。`MailChat`）を置く。提案の行の状態とハーフモーダルは両方で共有する（`useFlowCards`）。
 * 型だけをimportする（`*-core.ts` の値は読み込まない）。
 */

/** 別のメールを分析中（429）のときに取り直すまでの待ちと回数。 */
const BUSY_RETRY_MS = 5000;
const BUSY_RETRY_MAX = 24;

export function MailAnalysis({ id, registeredKinds }: { id: string; registeredKinds: string[] }) {
  const [loading, setLoading] = useState(true);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Analysis | null>(null);
  const [rowIds, setRowIds] = useState<string[]>([]);
  const flow = useFlowCards(id);
  const { replace } = flow;
  const controller = useRef<AbortController | null>(null);

  /** 結果を画面へ反映する。中断された回（別の取得に置き換わった・画面を離れた）は何もしない。 */
  const apply = useCallback(
    (abort: AbortController, outcome: AnalyzeResponse) => {
      if (abort.signal.aborted || controller.current !== abort) return;
      setLoading(false);
      setWaiting(false);
      if (!outcome.ok) {
        setError(outcome.error);
        return;
      }
      const { summary, suggest } = outcome.value;
      setError(null);
      setResult({ summary, suggest });
      // おすすめを先頭に並べる
      const sorted = [...suggest.suggestions].sort((a, b) => Number(b.kind === suggest.recommended) - Number(a.kind === suggest.recommended));
      const next: Record<string, FlowRow> = {};
      sorted.forEach((card, index) => (next[`a-${index}`] = { card, recommended: card.kind === suggest.recommended }));
      replace("a-", next);
      setRowIds(Object.keys(next));
    },
    [replace],
  );

  const start = useCallback(
    (refresh: boolean) => {
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      void requestAnalysis(id, refresh, abort.signal, () => {
        if (!abort.signal.aborted) setWaiting(true);
      }).then((outcome) => apply(abort, outcome));
      return abort;
    },
    [id, apply],
  );

  useEffect(() => {
    // 初回は最初から読み込み中（loadingの初期値）。effectの中では同期にsetStateしない
    const abort = start(false);
    return () => abort.abort();
  }, [start]);

  return (
    <section aria-label="AIの分析" aria-busy={loading} className="flex flex-col gap-2 rounded-xl border border-border bg-surface px-3.5 py-3 text-xs leading-relaxed">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.6875rem] text-muted">
          ✨ AIの分析
          {loading
            ? waiting
              ? "　前のAIの処理が終わるのを待っています…"
              : "　本文を読んでいます…（30秒ほどかかることがあります）"
            : "（本文を読んで作成。外れることがあります）"}
        </p>
        {!loading && (
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              setError(null);
              start(true);
            }}
            className="shrink-0 rounded-[9px] border border-border bg-background px-2.5 py-1 text-[0.6875rem] font-bold transition-colors hover:bg-rail-active"
          >
            ↻ 分析し直す
          </button>
        )}
      </div>

      {loading && (
        <div aria-hidden className="flex flex-col gap-2 py-1">
          <div className="h-2.5 w-[92%] animate-pulse rounded bg-rail-active" />
          <div className="h-2.5 w-[70%] animate-pulse rounded bg-rail-active" />
          <div className="mt-1 h-10 w-full max-w-[420px] animate-pulse rounded-[10px] bg-rail-active" />
        </div>
      )}

      {!loading && error && (
        <p role="alert" className="rounded-[10px] border border-danger/30 bg-danger-surface px-3 py-2 text-danger">
          {error}
        </p>
      )}

      {!loading && result && (
        <>
          <div>
            <p>{result.summary.summary}</p>
            {result.summary.points.length > 0 && (
              <ul className="mt-1 list-disc pl-4">
                {result.summary.points.map((point, index) => (
                  <li key={index}>{point}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-border pt-2">
            <p className="mb-1.5 text-[0.6875rem] text-muted">おすすめの処理</p>
            {rowIds.length === 0 ? (
              <p className="text-muted">このメールには、とくに必要な処理は見つかりませんでした。</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {rowIds.map((rowId) => {
                  const row = flow.rows[rowId];
                  if (!row) return null;
                  return (
                    <li key={rowId}>
                      <FlowRowButton
                        card={row.card}
                        recommended={row.recommended}
                        registered={flow.outcomes[rowId]?.done === true || registeredKinds.includes(row.card.kind)}
                        onOpen={() => flow.setOpen(rowId)}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}

      <MailChat id={id} analyzing={loading} flow={flow} />

      {flow.sheet}
    </section>
  );
}

type AnalyzeResponse = { ok: true; value: Analysis } | { ok: false; error: string };

/** 分析を取りに行く。別のメールを分析中（429）なら待って取り直す。中断されたら「中断」として返す（画面には出さない）。 */
async function requestAnalysis(id: string, refresh: boolean, signal: AbortSignal, onWaiting: () => void): Promise<AnalyzeResponse> {
  try {
    for (let attempt = 0; ; attempt++) {
      const response = await fetch("/api/mail/flow/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, refresh }),
        signal,
      });
      const data = (await response.json().catch(() => null)) as (Analysis & { error?: string }) | null;
      if (response.status === 429 && attempt < BUSY_RETRY_MAX) {
        // 前に開いたメールの分析が終わるのを待つ（利用者ごとに同時1件）
        onWaiting();
        await new Promise((resolve) => setTimeout(resolve, BUSY_RETRY_MS));
        if (signal.aborted) return { ok: false, error: "中断しました。" };
        continue;
      }
      if (!response.ok || !data?.summary || !data.suggest) {
        return { ok: false, error: data?.error ?? `分析できませんでした（HTTP ${response.status}）。` };
      }
      return { ok: true, value: { summary: data.summary, suggest: data.suggest } };
    }
  } catch {
    return { ok: false, error: "分析できませんでした（通信できませんでした）。" };
  }
}
