"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { FlowSheet, KIND_META, type CardResult } from "@/components/mail/flow-sheet";
import type { MailAnalysis as Analysis } from "@/lib/mail/analyze-core";
import type { Suggestion, SuggestKind } from "@/lib/mail/suggest-core";
import { cn } from "@/lib/utils";

/**
 * メールのAI分析（#766）。開いた時点で自動で要約と処理の提案を取り（`POST /api/mail/flow/analyze`。Codexは1回）、
 * 1枚のカードに並べる。提案の行には入力欄を出さず、押すとハーフモーダル（`FlowSheet`）が開く。
 * 以前の「📝 要約する」（#717）と「✨ このメールをどうする？」（#689）の2つのボタンを置き換えた。
 * 型だけをimportする（`*-core.ts` の値は読み込まない）。
 */

/** 別のメールを分析中（429）のときに取り直すまでの待ちと回数。 */
const BUSY_RETRY_MS = 5000;
const BUSY_RETRY_MAX = 24;

export function MailAnalysis({ id, registeredKinds }: { id: string; registeredKinds: string[] }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Analysis | null>(null);
  const [cards, setCards] = useState<Suggestion[]>([]);
  const [outcomes, setOutcomes] = useState<Record<string, CardResult>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [open, setOpen] = useState<SuggestKind | null>(null);
  const controller = useRef<AbortController | null>(null);

  /** 結果を画面へ反映する。中断された回（別の取得に置き換わった・画面を離れた）は何もしない。 */
  const apply = useCallback((abort: AbortController, outcome: AnalyzeResponse) => {
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
    setOutcomes({});
    // おすすめを先頭に並べる
    setCards([...suggest.suggestions].sort((a, b) => Number(b.kind === suggest.recommended) - Number(a.kind === suggest.recommended)));
  }, []);

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

  function edit(kind: SuggestKind, key: string, value: string) {
    setCards((current) =>
      current.map((card) => {
        if (card.kind !== kind) return card;
        const fields = { ...card.fields } as Record<string, unknown>;
        if (key === "amount" || key === "day") {
          const n = value.trim() === "" ? null : Number(value.replace(/[,，]/g, ""));
          fields[key] = n !== null && Number.isFinite(n) ? (card.kind === "subscription" && key === "amount" ? n : Math.round(n)) : null;
        } else {
          fields[key] = value === "" && key !== "title" && key !== "name" && key !== "memo" ? null : value;
        }
        return { ...card, fields } as Suggestion;
      }),
    );
  }

  /** サブスク一覧を開いたことを控えに残す（#750。#766の計画レビューで引き継ぎを確認）。登録できたかは分からないので「開いた」として残る。失敗しても開くのは止めない。 */
  function recordOpened(card: Suggestion) {
    fetch("/api/mail/flow/subscription", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, fields: card.fields }),
      keepalive: true,
    })
      .then(() => router.refresh())
      .catch(() => {});
  }

  async function run(card: Suggestion) {
    setRunning(card.kind);
    try {
      const response = await fetch("/api/mail/flow/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, kind: card.kind, fields: card.fields, confidence: card.confidence }),
      });
      const data = (await response.json().catch(() => null)) as { message?: string; error?: string; status?: string; labeled?: boolean } | null;
      if (!response.ok) {
        setOutcomes((o) => ({ ...o, [card.kind]: { text: data?.error ?? `実行できませんでした（HTTP ${response.status}）。`, error: true, done: false } }));
        return;
      }
      const failed = data?.status === "failed";
      setOutcomes((o) => ({
        ...o,
        [card.kind]: { text: `${data?.message ?? "実行しました。"}${data?.labeled ? "「処理済み」ラベルを付けました。" : ""}`, error: failed, done: !failed },
      }));
      // 登録した内容の欄（#750）と「処理済み」ラベルを更新する
      if (!failed) router.refresh();
    } catch {
      setOutcomes((o) => ({ ...o, [card.kind]: { text: "実行できませんでした（通信できませんでした）。", error: true, done: false } }));
    } finally {
      setRunning(null);
    }
  }

  const openCard = cards.find((card) => card.kind === open) ?? null;

  return (
    <section aria-label="AIの分析" aria-busy={loading} className="flex flex-col gap-2 rounded-xl border border-border bg-surface px-3.5 py-3 text-xs leading-relaxed">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.6875rem] text-muted">
          ✨ AIの分析
          {loading
            ? waiting
              ? "　前に開いたメールの分析が終わるのを待っています…"
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
            {cards.length === 0 ? (
              <p className="text-muted">このメールには、とくに必要な処理は見つかりませんでした。</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {cards.map((card) => {
                  const meta = KIND_META[card.kind];
                  const recommended = card.kind === result.suggest.recommended;
                  const registered = outcomes[card.kind]?.done === true || registeredKinds.includes(card.kind);
                  return (
                    <li key={card.kind}>
                      <button
                        type="button"
                        onClick={() => setOpen(card.kind)}
                        aria-haspopup="dialog"
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-[10px] bg-background px-3 py-2.5 text-left transition-colors hover:bg-rail-active",
                          recommended ? "border-2 border-accent" : "border border-border",
                        )}
                      >
                        <span aria-hidden className="text-lg">
                          {meta.icon}
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="flex flex-wrap items-center gap-1.5 font-bold">
                            {meta.title}
                            {recommended && <span className="rounded-full bg-accent px-2 py-0.5 text-[0.625rem] font-bold text-accent-foreground">おすすめ</span>}
                            {registered && <span className="rounded-full bg-fair-surface px-2 py-0.5 text-[0.625rem] font-bold text-fair">登録済み</span>}
                          </span>
                          {cardPreview(card) && <span className="truncate opacity-85">{cardPreview(card)}</span>}
                          {card.reason && (
                            <span className="text-[0.6875rem] text-muted">
                              {card.reason}（確度 {card.confidence >= 0.75 ? "高" : card.confidence >= 0.45 ? "中" : "低"}）
                            </span>
                          )}
                        </span>
                        <span aria-hidden className="text-lg text-muted">
                          ›
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}

      <FlowSheet
        card={openCard}
        recommended={openCard?.kind === result?.suggest.recommended}
        outcome={openCard ? outcomes[openCard.kind] : undefined}
        running={openCard !== null && running === openCard.kind}
        onEdit={edit}
        onRun={run}
        onOpenSubscription={recordOpened}
        onClose={() => setOpen(null)}
      />
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

/** 提案の行に出す、読み取った値の短い並び（「関西電力・7,842円・11/5」）。 */
function cardPreview(card: Suggestion): string {
  const day = (value: string | null) => (value ? `${Number(value.slice(5, 7))}/${Number(value.slice(8, 10))}` : null);
  const parts: (string | null)[] =
    card.kind === "payment"
      ? [card.fields.place, card.fields.name, card.fields.amount !== null ? `${card.fields.amount.toLocaleString("ja-JP")}円` : null, day(card.fields.date)]
      : card.kind === "subscription"
        ? [card.fields.name, card.fields.amount !== null ? `${card.fields.amount.toLocaleString("ja-JP")}${card.fields.currency === "USD" ? "ドル" : "円"}` : null, card.fields.cycle === "YEARLY" ? "毎年" : "毎月"]
        : card.kind === "task"
          ? [card.fields.title, card.fields.due ? `期限 ${day(card.fields.due)}` : null]
          : [card.fields.title, day(card.fields.date), card.fields.startTime ? `${card.fields.startTime}〜${card.fields.endTime ?? ""}` : null];
  return parts.filter((part): part is string => Boolean(part)).join("・");
}
