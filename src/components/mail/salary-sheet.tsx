"use client";

import { useEffect, useRef, useState } from "react";

import { SALARY_MANUAL_IMPORT_URL, type SalaryCommitResult, type SalaryPreview } from "@/lib/mail/salary-core";
import { cn } from "@/lib/utils";

/**
 * 給与明細PDFをAsset Managerの給与台帳へ取り込むシート（#1170）。
 *
 * 1. 開いた時点で解析（`/api/mail/salary` の preview）。支給日の候補・総支給・手取・保存を止める理由を見せる
 * 2. 「Asset Managerで承認する ↗」で承認画面を開く（支給日の確定と承認はAsset Managerで本人が行う）
 * 3. 戻って「承認したので登録する」で保存→読み戻し。承認されていなければその旨を出す
 *
 * 金額はこの画面のstateにだけ持つ（保存しない）。
 */

type Target = { messageId: string; attachmentId: string; filename: string };

type State =
  | { step: "loading" }
  | { step: "failed"; message: string; manual: boolean }
  | { step: "preview"; preview: SalaryPreview; committing: boolean; notice: string | null; error: string | null }
  | { step: "done"; preview: SalaryPreview; result: SalaryCommitResult };

const yen = (value: number | null) => (value === null ? "—" : `${Math.round(value).toLocaleString("ja-JP")}円`);

async function post(body: Record<string, unknown>): Promise<{ ok: boolean; json: Record<string, unknown> | null }> {
  const response = await fetch("/api/mail/salary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  return { ok: response.ok, json };
}

export function SalarySheet({ target, onClose }: { target: Target | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<State>({ step: "loading" });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (target && !dialog.open) dialog.showModal();
    if (!target && dialog.open) dialog.close();
  }, [target]);

  useEffect(() => {
    if (!target) return;
    // 開くたびに作り直される（呼び出し側が閉じたら外す）ので、初期状態は loading のまま
    let cancelled = false;
    post({ action: "preview", messageId: target.messageId, attachmentId: target.attachmentId })
      .then(({ ok, json }) => {
        if (cancelled) return;
        const preview = json?.preview as SalaryPreview | undefined;
        if (ok && preview) setState({ step: "preview", preview, committing: false, notice: null, error: null });
        else setState({ step: "failed", message: typeof json?.error === "string" ? json.error : "解析できませんでした。", manual: json?.manual === true });
      })
      .catch(() => !cancelled && setState({ step: "failed", message: "通信できませんでした。時間をおいてやり直してください。", manual: false }));
    return () => {
      cancelled = true;
    };
  }, [target]);

  const commit = async () => {
    if (state.step !== "preview") return;
    const preview = state.preview;
    setState({ ...state, committing: true, notice: null, error: null });
    try {
      const { ok, json } = await post({ action: "commit", previewId: preview.previewId });
      const result = json?.result as SalaryCommitResult | undefined;
      if (!ok || !result) {
        setState({ step: "preview", preview, committing: false, notice: null, error: typeof json?.error === "string" ? json.error : "登録できませんでした。" });
        return;
      }
      if (result.status === "not_approved") setState({ step: "preview", preview, committing: false, notice: result.message, error: null });
      else setState({ step: "done", preview, result });
    } catch {
      // 送れたかどうか分からないので、もう一度押しても承認状態の確認から始まる（承認済みでも同じメールは二重に作られない）
      setState({ step: "preview", preview, committing: false, notice: null, error: "通信が途中で切れました。Asset Managerの給与一覧で登録されたか確かめてください。" });
    }
  };

  return (
    <dialog
      ref={ref}
      aria-label="給与明細の取り込み"
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
      className="flow-sheet fixed inset-x-0 bottom-[var(--keyboard-inset)] top-auto m-0 mx-auto max-h-[min(85dvh,calc(var(--app-height)-1rem))] w-full max-w-[560px] overflow-y-auto rounded-t-[18px] border border-border bg-surface p-0 text-foreground backdrop:bg-black/55"
    >
      {target && (
        <div className="flex flex-col gap-3 px-4 pb-[calc(1.25rem+var(--app-bottom-inset))] pt-2">
          <div aria-hidden className="mx-auto h-[5px] w-10 rounded-full bg-border" />
          <h2 className="text-[0.9375rem] font-bold">💴 給与明細をAsset Managerへ取り込む</h2>
          <p className="break-all text-xs text-muted">{target.filename}</p>
          <Body state={state} onCommit={() => void commit()} />
          <button type="button" onClick={() => ref.current?.close()} className="rounded-[10px] border border-border bg-surface px-3 py-2.5 text-sm">
            閉じる
          </button>
        </div>
      )}
    </dialog>
  );
}

const primary = "block rounded-[10px] border border-accent bg-accent px-3 py-2.5 text-center text-sm font-semibold text-accent-foreground disabled:opacity-50";
const secondary = "block rounded-[10px] border border-border bg-surface px-3 py-2.5 text-center text-sm";

function ManualLink() {
  return (
    <a href={SALARY_MANUAL_IMPORT_URL} target="_blank" rel="noopener noreferrer" className={secondary}>
      Asset Managerの給与の登録画面を開く ↗
    </a>
  );
}

function Body({ state, onCommit }: { state: State; onCommit: () => void }) {
  if (state.step === "loading") return <p className="py-4 text-center text-sm text-muted">PDFを解析しています…（数十秒かかることがあります）</p>;
  if (state.step === "failed") {
    return (
      <>
        <p className="rounded-md bg-danger-surface px-3 py-2 text-[0.8125rem] text-danger">{state.message}</p>
        {state.manual && <ManualLink />}
      </>
    );
  }
  if (state.step === "done") return <Done preview={state.preview} result={state.result} />;

  const { preview } = state;
  const already = preview.alreadyImportedSalaryId !== null;
  return (
    <>
      <Summary preview={preview} />
      {already ? (
        <p className="rounded-md bg-fair-surface px-3 py-2 text-[0.8125rem] text-fair">このメールの給与明細はAsset Managerに登録済みです。</p>
      ) : preview.blockers.length > 0 || preview.sameDateSalaryId ? (
        <div className="rounded-md bg-danger-surface px-3 py-2 text-[0.8125rem] text-danger">
          <p className="font-semibold">このままでは登録できません</p>
          <ul className="mt-1 list-disc pl-5">
            {preview.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
            {preview.sameDateSalaryId && <li>同じ支給日の明細がすでにあります</li>}
          </ul>
        </div>
      ) : null}
      {!already &&
        (preview.approvalUrl ? (
          <>
            <ol className="list-decimal pl-5 text-xs leading-relaxed text-muted">
              <li>Asset Managerの承認画面で、支給日を確かめて「承認」を押す</li>
              <li>この画面へ戻って「承認したので登録する」を押す</li>
            </ol>
            <a href={preview.approvalUrl} target="_blank" rel="noopener noreferrer" className={secondary}>
              Asset Managerで承認する ↗
            </a>
            <button type="button" onClick={onCommit} disabled={state.committing} className={primary}>
              {state.committing ? "確認して登録しています…" : "承認したので登録する"}
            </button>
          </>
        ) : (
          <>
            <p className="text-[0.8125rem] text-danger">承認画面を開けません。Asset Managerの給与の登録画面で取り込んでください。</p>
            <ManualLink />
          </>
        ))}
      {state.notice && <p className="rounded-md bg-[#fdf3dc] px-3 py-2 text-[0.8125rem] text-[#8a5a12] dark:bg-[#3a2e14] dark:text-[#f0c674]">{state.notice}</p>}
      {state.error && <p className="text-[0.8125rem] text-danger">{state.error}</p>}
      <p className="text-[0.6875rem] text-muted">承認の期限は30分です。登録はAsset Managerで承認した後だけ行い、元に戻すときはAsset Managerで削除します。</p>
    </>
  );
}

function Summary({ preview }: { preview: SalaryPreview }) {
  const period = preview.year && preview.month ? `${preview.year}年${preview.month}月分` : "年月不明";
  const mismatch = (computed: number | null, pdf: number | null) => computed !== null && pdf !== null && Math.round(computed) !== Math.round(pdf);
  return (
    <div className="rounded-[12px] border border-border px-3 py-2.5 text-[0.8125rem]">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted">対象</dt>
        <dd>{period}</dd>
        <dt className="text-muted">支給日（候補）</dt>
        <dd>{preview.salaryDateCandidate ?? "不明"}<span className="ml-1 text-[0.6875rem] text-muted">承認画面で確定します</span></dd>
        <dt className="text-muted">総支給</dt>
        <dd className={cn(mismatch(preview.grossSalary, preview.pdfGrossTotal) && "text-danger")}>
          {yen(preview.grossSalary)}
          {mismatch(preview.grossSalary, preview.pdfGrossTotal) && `（明細は${yen(preview.pdfGrossTotal)}）`}
        </dd>
        <dt className="text-muted">手取</dt>
        <dd className={cn(mismatch(preview.netSalary, preview.pdfNetTotal) && "text-danger")}>
          {yen(preview.netSalary)}
          {mismatch(preview.netSalary, preview.pdfNetTotal) && `（明細は${yen(preview.pdfNetTotal)}）`}
        </dd>
      </dl>
      {preview.lines.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted">読み取った項目（{preview.lines.length}）</summary>
          <ul className="mt-1 flex flex-col gap-0.5 text-xs">
            {preview.lines.map((line, i) => (
              <li key={`${line.label}-${i}`} className="flex justify-between gap-2">
                <span className="min-w-0 break-all">
                  {line.label}
                  {line.destinationLabel && line.destinationLabel !== line.label && <span className="text-muted"> → {line.destinationLabel}</span>}
                </span>
                <span className="shrink-0 tabular-nums">{yen(line.amount)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {preview.unassignedLabels.length > 0 && <p className="mt-1 text-xs text-danger">反映先が決まらない項目: {preview.unassignedLabels.join("、")}</p>}
    </div>
  );
}

function Done({ preview, result }: { preview: SalaryPreview; result: SalaryCommitResult }) {
  if (result.status === "registered") {
    return (
      <>
        <Summary preview={preview} />
        <p className="rounded-md bg-fair-surface px-3 py-2 text-[0.8125rem] text-fair">
          {result.already ? "このメールの給与明細はすでに登録済みでした（新しくは作っていません）。" : "Asset Managerの給与台帳に登録しました。"}
          {result.record
            ? ` 支給日 ${result.record.salaryDate ?? "不明"}・総支給 ${yen(result.record.grossSalary)}・手取 ${yen(result.record.netSalary)}`
            : " 登録内容の読み戻しはできませんでした。Asset Managerで確かめてください。"}
        </p>
      </>
    );
  }
  if (result.status === "unknown") {
    return <p className={cn("rounded-md px-3 py-2 text-[0.8125rem]", result.confirmed === "unconfirmed" ? "bg-danger-surface text-danger" : "bg-[#fdf3dc] text-[#8a5a12] dark:bg-[#3a2e14] dark:text-[#f0c674]")}>{result.message}</p>;
  }
  return (
    <>
      <p className="rounded-md bg-danger-surface px-3 py-2 text-[0.8125rem] text-danger">{result.message}</p>
      <ManualLink />
    </>
  );
}
