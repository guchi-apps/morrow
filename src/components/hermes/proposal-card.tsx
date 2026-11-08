"use client";

import { useState } from "react";

import type { FieldValue, FieldView, ProposalView } from "@/lib/hermes/proposal-core";

/**
 * Hermesの提案の確認カード（#748。チャット画面〔#728〕が差し込む）。値を見て、必要なら直して「実行」「やめる」を押す。
 * 実行・取り下げはサーバーが検証し直す。確定したら値は消え、結果の一文だけになる。
 */

const STATUS_LABEL: Record<ProposalView["status"], string> = {
  pending: "承認待ち",
  executing: "実行中",
  done: "実行済み",
  cancelled: "取り下げ",
  expired: "期限切れ",
  failed: "失敗",
  unknown: "結果不明",
};

const TAG: Record<ProposalView["status"], string> = {
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  executing: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  done: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  cancelled: "bg-border text-muted",
  expired: "bg-border text-muted",
  failed: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  unknown: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

const ENUM_LABEL: Record<string, string> = { MONTHLY: "毎月", YEARLY: "毎年", JPY: "円", USD: "ドル" };

function remaining(expiresAt: string): string {
  const minutes = Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 60_000));
  return `あと${minutes}分`;
}

function show(field: FieldView): string {
  if (field.value === null) return "";
  if (typeof field.value === "boolean") return field.value ? "はい" : "いいえ";
  return String(field.value);
}

type Props = { proposal: ProposalView; onChange?: (next: ProposalView) => void };

export function ProposalCard({ proposal, onChange }: Props) {
  const [view, setView] = useState(proposal);
  const [edits, setEdits] = useState<Record<string, FieldValue>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(action: "execute" | "cancel") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/hermes/proposals/${encodeURIComponent(view.id)}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "execute" ? { fields: edits } : {}),
      });
      const data = (await response.json().catch(() => null)) as { proposal?: ProposalView | null; error?: string } | null;
      if (data?.proposal) {
        setView(data.proposal);
        onChange?.(data.proposal);
      }
      if (!response.ok) setError(data?.error ?? "実行できませんでした。");
    } catch {
      setError("通信できませんでした。結果が分からないので、画面を開き直して状態を確かめてください。");
    } finally {
      setBusy(false);
    }
  }

  // 直した値でボタンの可否を決めるのはサーバー。ここでは「要確認」が残っているかだけを見て押せなくする
  const blocked = view.fields.some((f) => f.needsCheck && (edits[f.key] === undefined || edits[f.key] === ""));
  const live = view.status === "pending";
  const border = view.danger && live ? "border-l-red-600" : view.status === "failed" || view.status === "unknown" ? "border-l-red-600" : "border-l-amber-500";

  return (
    <section className={`max-w-[560px] rounded-xl border border-border border-l-4 ${border} bg-surface p-3.5 text-sm`}>
      <div className="flex flex-wrap items-center gap-2 font-semibold">
        <span>{view.label}</span>
        <span className={`rounded-full px-2 py-px text-xs font-normal ${TAG[view.status]}`}>{STATUS_LABEL[view.status]}</span>
        {live ? <span className="rounded-full bg-border px-2 py-px text-xs font-normal text-muted">{remaining(view.expiresAt)}</span> : null}
      </div>

      {view.summary && live ? <p className="mt-1 text-xs text-muted">{view.summary}</p> : null}

      {view.preview && (live || view.status === "unknown") ? (
        <div className="mt-2 rounded-lg bg-red-50 px-2.5 py-2 dark:bg-red-950">
          <b>{view.preview.title}</b>
          <br />
          {[view.preview.when, view.preview.calendar].filter(Boolean).join(" ／ ")}
          <div className="text-xs text-muted">Morrowが削除前に実物を確認した内容です（削除はしていません）</div>
        </div>
      ) : null}
      {view.tool === "aide_delete_event" && live && !view.preview ? (
        <p className="mt-2 text-xs text-amber-700">消える予定を確認できませんでした。実行できないので、頼み直してください。</p>
      ) : null}

      {live && view.fields.length > 0 ? (
        <dl className="mt-2 grid grid-cols-[7em_1fr] gap-x-2.5 gap-y-1">
          {view.fields
            .filter((f) => !(view.preview && !f.editable))
            .map((f) => (
              <div key={f.key} className="contents">
                <dt className="text-xs text-muted">{f.label}</dt>
                <dd>
                  {f.editable ? (
                    <>
                      <input
                        aria-label={f.label}
                        className={`w-full rounded-md border px-2 py-1 ${f.needsCheck ? "border-amber-500 bg-amber-50 dark:bg-amber-950" : "border-border bg-background"}`}
                        defaultValue={show(f)}
                        placeholder={f.needsCheck ? "要確認" : ""}
                        onChange={(e) => setEdits((prev) => ({ ...prev, [f.key]: e.target.value }))}
                      />
                      {f.needsCheck ? <div className="text-xs text-amber-700">読み取れませんでした。入力してください</div> : null}
                    </>
                  ) : (
                    <span className="break-all">{ENUM_LABEL[show(f)] ?? show(f)}</span>
                  )}
                </dd>
              </div>
            ))}
        </dl>
      ) : null}

      {view.message ? <p className="mt-2">{view.message}</p> : null}
      {view.reason ? <p className="mt-1 text-xs text-muted">理由: {view.reason}</p> : null}
      {error ? <p className="mt-2 text-xs text-red-700" role="alert">{error}</p> : null}

      <div className="mt-2.5 flex flex-wrap gap-2">
        {live ? (
          <button
            type="button"
            disabled={busy || blocked || (view.tool === "aide_delete_event" && !view.preview)}
            onClick={() => send("execute")}
            className={`rounded-lg px-4 py-2 text-white disabled:opacity-45 ${view.danger ? "bg-red-600" : "bg-accent"}`}
          >
            {view.danger ? "削除する" : "実行"}
          </button>
        ) : null}
        {view.canRetry ? (
          <button type="button" disabled={busy} onClick={() => send("execute")} className="rounded-lg bg-accent px-4 py-2 text-white disabled:opacity-45">
            もう一度実行
          </button>
        ) : null}
        {view.canCancel ? (
          <button type="button" disabled={busy} onClick={() => send("cancel")} className="rounded-lg border border-border px-4 py-2 disabled:opacity-45">
            {view.status === "unknown" ? "確認した（閉じる）" : "やめる"}
          </button>
        ) : null}
      </div>
    </section>
  );
}
