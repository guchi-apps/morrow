"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { FlowRowButton } from "@/components/mail/flow-row";
import { MailChat } from "@/components/mail/mail-chat";
import { useTypewriter } from "@/components/mail/typewriter";
import { useFlowCards, type FlowRow } from "@/components/mail/use-flow-cards";
import { ANALYZE_RETRY_MS, shouldRetryAnalysis } from "@/lib/mail/analyze-retry";
import { TYPEWRITER_MAX_MS, elapsedLabel, splitVisible } from "@/lib/mail/typewriter-core";
import type { ReceiptState } from "@/lib/mail/flow-record-core";
import type { MailAnalysis as Analysis } from "@/lib/mail/analyze-core";
import { shortageTask, type BalanceCheck } from "@/lib/mail/withdrawal-core";

/**
 * メールのAI分析（#766）。開いた時点で自動で要約と処理の提案を取り（`POST /api/mail/flow/analyze`。Codexは1回）、
 * 1枚のカードに並べる。提案の行には入力欄を出さず、押すとハーフモーダル（`FlowSheet`）が開く。
 * 以前の「📝 要約する」（#717）と「✨ このメールをどうする？」（#689）の2つのボタンを置き換えた。
 * カードの末尾に、本文への指示（#784。`MailChat`）を置く。提案の行の状態とハーフモーダルは両方で共有する（`useFlowCards`）。
 * 型だけをimportする（`*-core.ts` の値は読み込まない）。
 */


export function MailAnalysis({ id, registeredKinds, receiptState = null }: { id: string; registeredKinds: string[]; receiptState?: ReceiptState | null }) {
  const [loading, setLoading] = useState(true);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Analysis | null>(null);
  /** 新しく作られた結果だけ文字送りする（記憶から返った結果は即表示。#838）。`runId` は結果ごとの鍵。 */
  const [animate, setAnimate] = useState(false);
  const [runId, setRunId] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [rowIds, setRowIds] = useState<string[]>([]);
  const [balance, setBalance] = useState<BalanceCheck | null>(null);
  const [balanceBusy, setBalanceBusy] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const flow = useFlowCards(id);
  const { replace } = flow;
  const controller = useRef<AbortController | null>(null);

  /** 残高確認の結果を反映する。不足のときだけ、入金のタスクを提案の行として共有する（#842。登録は既存の確認シート・`/apply` を通る）。 */
  const showBalance = useCallback(
    (check: BalanceCheck | null) => {
      setBalance(check);
      replace("w-", check?.status === "short" ? { "w-0": { card: { kind: "task", reason: "残高が足りません", confidence: 1, fields: shortageTask(check) }, recommended: true } } : {});
    },
    [replace],
  );

  const recheck = useCallback(async () => {
    setBalanceBusy(true);
    setBalanceError(null);
    try {
      const response = await fetch("/api/mail/flow/balance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
      const data = (await response.json().catch(() => null)) as { balance?: BalanceCheck | null; error?: string } | null;
      if (!response.ok || !data) setBalanceError(data?.error ?? `確認できませんでした（HTTP ${response.status}）。`);
      else showBalance(data.balance ?? null);
    } catch {
      setBalanceError("確認できませんでした（通信できませんでした）。");
    } finally {
      setBalanceBusy(false);
    }
  }, [id, showBalance]);

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
      const { summary, suggest, withdrawal, balance: check } = outcome.value;
      setError(null);
      setResult({ summary, suggest, withdrawal });
      setAnimate(!outcome.value.cached);
      setRunId((n) => n + 1);
      showBalance(check);
      // おすすめを先頭に並べる
      const sorted = [...suggest.suggestions].sort((a, b) => Number(b.kind === suggest.recommended) - Number(a.kind === suggest.recommended));
      const next: Record<string, FlowRow> = {};
      sorted.forEach((card, index) => (next[`a-${index}`] = { card, recommended: card.kind === suggest.recommended }));
      replace("a-", next);
      setRowIds(Object.keys(next));
    },
    [replace, showBalance],
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

  // 分析を待っている経過秒（#838）。setStateはタイマーのコールバックの中だけ
  useEffect(() => {
    if (!loading) return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed((Date.now() - started) / 1000), 1000);
    return () => {
      clearInterval(timer);
      setElapsed(0);
    };
  }, [loading]);

  // 別アプリから戻ったとき、分析中なら通信を張り直す（止まったままのfetchを待たない。#840）。
  // サーバーの分析は続いているので、取り直しは走っている1回か保存済みの結果を拾う。
  const loadingRef = useRef(true);
  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && loadingRef.current) start(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
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
        <p role="status" className="flex flex-wrap items-center gap-1.5 text-[0.6875rem]">
          <span className={`rounded-full px-2.5 py-0.5 font-bold ${waiting ? "bg-rail-active text-muted" : "bg-accent text-white"}`}>
            {waiting ? "前のAIの処理を待っています" : `AIが分析中 ${elapsedLabel(elapsed)}`}
          </span>
        </p>
      )}

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
          <SummaryReveal summary={result.summary.summary} points={result.summary.points} animate={animate} resetKey={runId} />

          {balance && (
            <BalanceCard
              check={balance}
              busy={balanceBusy}
              error={balanceError}
              onRecheck={recheck}
              task={
                flow.rows["w-0"] ? (
                  <FlowRowButton
                    card={flow.rows["w-0"].card}
                    recommended
                    registered={flow.outcomes["w-0"]?.done === true}
                    receipt={null}
                    onOpen={() => flow.setOpen("w-0")}
                  />
                ) : null
              }
            />
          )}

          <div className={`border-t border-border pt-2 ${animate ? "analysis-reveal" : ""}`} style={animate ? ({ "--reveal-delay": `${TYPEWRITER_MAX_MS}ms` } as React.CSSProperties) : undefined}>
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
                        registered={(flow.outcomes[rowId]?.done === true && !flow.outcomes[rowId]?.receipt) || registeredKinds.includes(row.card.kind)}
                        receipt={flow.outcomes[rowId]?.receipt ?? (row.card.kind === "payment" ? receiptState : null)}
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

/** 要約と要点の文字送り（#838）。`animate` が偽なら最初から全部出す。 */
function SummaryReveal({ summary, points, animate, resetKey }: { summary: string; points: string[]; animate: boolean; resetKey: number }) {
  const parts = [summary, ...points];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const shown = useTypewriter(total, animate, resetKey);
  const [head, ...rest] = splitVisible(parts, shown);
  const typing = animate && shown < total;
  const lastIndex = rest.findLastIndex((text) => text !== "");
  return (
    <div>
      <p>
        {head}
        {typing && lastIndex < 0 && <span aria-hidden className="analysis-caret ml-px inline-block h-[1em] w-0.5 bg-accent align-text-bottom" />}
      </p>
      {points.length > 0 && (
        <ul className="mt-1 list-disc pl-4">
          {rest.map((text, index) =>
            text === "" ? null : (
              <li key={index}>
                {text}
                {typing && index === lastIndex && <span aria-hidden className="analysis-caret ml-px inline-block h-[1em] w-0.5 bg-accent align-text-bottom" />}
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

type AnalyzeResponse = { ok: true; value: Analysis & { balance: BalanceCheck | null; cached: boolean } } | { ok: false; error: string };

/** 分析を取りに行く。別のメールを分析中（429）なら待って取り直す。中断されたら「中断」として返す（画面には出さない）。 */
async function requestAnalysis(id: string, refresh: boolean, signal: AbortSignal, onWaiting: () => void): Promise<AnalyzeResponse> {
  const aborted: AnalyzeResponse = { ok: false, error: "中断しました。" };
  for (let attempt = 0; ; attempt++) {
    let status: number | "network";
    let data: (Analysis & { balance?: BalanceCheck | null; cached?: boolean; error?: string }) | null = null;
    try {
      const response = await fetch("/api/mail/flow/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // 取り直し（2回目以降）は分析し直さない。サーバーは走っている1回か保存済みの結果を返す（#840）
        body: JSON.stringify({ id, refresh: refresh && attempt === 0 }),
        signal,
      });
      status = response.status;
      data = (await response.json().catch(() => null)) as (Analysis & { balance?: BalanceCheck | null; cached?: boolean; error?: string }) | null;
      if (response.ok && data?.summary && data.suggest) return { ok: true, value: { summary: data.summary, suggest: data.suggest, withdrawal: data.withdrawal ?? null, balance: data.balance ?? null, cached: data.cached === true } };
    } catch {
      // 別アプリへ移るなどで通信だけが途切れた。サーバーの分析は続いているので取り直す
      if (signal.aborted) return aborted;
      status = "network";
    }
    if (shouldRetryAnalysis(status, attempt)) {
      // 前に開いたメールの分析が終わるのを待つ（429。利用者ごとに同時1件）／通信の復帰を待つ
      onWaiting();
      await new Promise((resolve) => setTimeout(resolve, ANALYZE_RETRY_MS));
      if (signal.aborted) return aborted;
      continue;
    }
    if (status === "network") return { ok: false, error: "分析できませんでした（通信できませんでした）。" };
    return { ok: false, error: data?.error ?? `分析できませんでした（HTTP ${status}）。` };
  }
}

const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;
const stamp = (iso: string) => iso.slice(0, 16).replace("T", " ");

/** 引き落とし前の残高確認（#842）。足りると言い切れないときは理由を出す。他の引き落とし・入金は含まない。 */
function BalanceCard({ check, busy, error, onRecheck, task }: { check: BalanceCheck; busy: boolean; error: string | null; onRecheck: () => void; task: React.ReactNode }) {
  const badge =
    check.status === "enough"
      ? { text: "足りています", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" }
      : check.status === "short"
        ? { text: `${yen(check.shortBy)} 足りません`, cls: "bg-danger-surface text-danger" }
        : { text: "確認できません", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300" };
  return (
    <div className="flex flex-col gap-1.5 border-t border-border pt-2" aria-label="引き落とし前の残高確認">
      <p className="flex flex-wrap items-center gap-2">
        <span className="text-[0.6875rem] text-muted">🏦 引き落とし前の残高確認</span>
        <span className={`rounded-full px-2.5 py-0.5 text-[0.6875rem] font-bold ${badge.cls}`}>{badge.text}</span>
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 tabular-nums">
        <dt className="text-muted">引き落とし額</dt>
        <dd className="text-right">{yen(check.amount)}{check.payee ? `（${check.payee}）` : ""}</dd>
        <dt className="text-muted">引き落とし日</dt>
        <dd className="text-right">{check.date ?? "メールに記載なし"}</dd>
        {check.status !== "unknown" && (
          <>
            <dt className="text-muted">{check.account}の残高</dt>
            <dd className="text-right">{yen(check.balance)}</dd>
            <dt className="text-muted">引き落とし後の見込み</dt>
            <dd className={`text-right font-bold ${check.status === "short" ? "text-danger" : ""}`}>{yen(check.after)}</dd>
          </>
        )}
      </dl>
      {check.status === "unknown" ? (
        <p className="text-muted">{check.reason}</p>
      ) : (
        <p className="text-[0.6875rem] text-muted">残高は{stamp(check.asOf)}時点（Zaim連携）。この日までの他の引き落とし・入金は含みません。</p>
      )}
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onRecheck}
          className="rounded-[9px] border border-border bg-background px-2.5 py-1 text-[0.6875rem] font-bold transition-colors hover:bg-rail-active disabled:opacity-60"
        >
          {busy ? "確認しています…" : "↻ 残高を確認し直す"}
        </button>
      </div>
      {task}
    </div>
  );
}
