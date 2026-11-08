"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { FLOW_APP_LINKS } from "@/lib/mail/app-links";
import type { Suggestion, SuggestKind } from "@/lib/mail/suggest-core";
import { subscriptionLink } from "@/lib/mail/subscription-link";
import { cn } from "@/lib/utils";

/**
 * 提案を押したときのハーフモーダル（#766）。AIが読み取った値を入れた入力欄を出し、直して登録できる。
 * 登録の経路は以前のカード（#689）と同じ `/api/mail/flow/apply`（サーバーが値を検証し直す）。
 * 下の「○○を開く」は記録の持ち主のアプリを開くだけで、入力値は引き継がない（サブスクは主ボタンが値を載せて開く。#709）。
 * 型だけをimportする（`suggest-core.ts` はサーバー専用の依存を持つため、値は読み込まない）。
 */

export const KIND_META: Record<SuggestKind, { icon: string; title: string; run: string }> = {
  payment: { icon: "🧾", title: "家計簿へ取り込む", run: "取り込む" },
  subscription: { icon: "🔁", title: "サブスクを確認する（Asset Managerで）", run: "Asset Managerのサブスク一覧を開く ↗" },
  task: { icon: "📌", title: "タスクにする", run: "タスクを作る" },
  event: { icon: "📅", title: "予定にする", run: "予定を登録する" },
};

export type CardResult = { text: string; error: boolean; done: boolean };

type Props = {
  card: Suggestion | null;
  recommended: boolean;
  outcome: CardResult | undefined;
  running: boolean;
  onEdit: (kind: SuggestKind, key: string, value: string) => void;
  onRun: (card: Suggestion) => void;
  onOpenSubscription: (card: Suggestion) => void;
  onClose: () => void;
};

const input = "w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm";

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1 text-[0.6875rem] text-muted", className)}>
      {label}
      {children}
    </label>
  );
}

export function FlowSheet({ card, recommended, outcome, running, onEdit, onRun, onOpenSubscription, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (card && !dialog.open) dialog.showModal();
    if (!card && dialog.open) dialog.close();
  }, [card]);

  const f = (card?.fields ?? {}) as Record<string, string | number | null>;
  const meta = card ? KIND_META[card.kind] : null;
  const app = card ? FLOW_APP_LINKS[card.kind] : null;

  return (
    <dialog
      ref={ref}
      aria-label={meta?.title ?? "提案"}
      onClose={onClose}
      // 背景（::backdrop）を押したら閉じる。中身の上の操作はdialog自身が対象にならない
      onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
      className="flow-sheet fixed inset-x-0 bottom-0 top-auto m-0 mx-auto max-h-[85dvh] w-full max-w-[560px] overflow-y-auto rounded-t-[18px] border border-border bg-surface p-0 text-foreground backdrop:bg-black/55"
    >
      {card && meta && app && (
        <div className="flex flex-col gap-3 px-4 pb-[calc(1.25rem+var(--app-bottom-inset))] pt-2">
          <div aria-hidden className="mx-auto h-[5px] w-10 rounded-full bg-border" />
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex flex-wrap items-center gap-2 text-[0.9375rem] font-bold">
              {meta.icon} {meta.title}
              {recommended && <span className="rounded-full bg-accent px-2 py-0.5 text-[0.6875rem] font-bold text-accent-foreground">おすすめ</span>}
            </h2>
            <button type="button" onClick={() => ref.current?.close()} aria-label="閉じる" className="rounded-md px-2 py-1 text-lg leading-none text-muted hover:bg-rail-active">
              ✕
            </button>
          </div>
          <p className="text-[0.6875rem] leading-relaxed text-muted">
            AIが本文から読み取った値です。外れることがあるので、確かめてから{card.kind === "subscription" ? "開いてください" : "登録してください"}。
            {card.reason && <>　理由: {card.reason}</>}
          </p>

          <div className="grid grid-cols-2 gap-2.5">
            {card.kind === "payment" && (
              <>
                <Field label="支払先" className="col-span-2">
                  <input className={cn(input, f.place === null && "border-danger/60")} value={String(f.place ?? "")} onChange={(e) => onEdit("payment", "place", e.target.value)} />
                </Field>
                <Field label="名称" className="col-span-2">
                  <input className={input} value={String(f.name ?? "")} onChange={(e) => onEdit("payment", "name", e.target.value)} />
                </Field>
                <Field label="金額（円）">
                  <input inputMode="numeric" className={cn(input, f.amount === null && "border-danger/60")} value={f.amount ?? ""} onChange={(e) => onEdit("payment", "amount", e.target.value)} />
                </Field>
                <Field label="日付">
                  <input type="date" className={cn(input, f.date === null && "border-danger/60")} value={String(f.date ?? "")} onChange={(e) => onEdit("payment", "date", e.target.value)} />
                </Field>
              </>
            )}
            {card.kind === "subscription" && (
              <>
                <Field label="名称" className="col-span-2">
                  <input className={input} value={String(f.name ?? "")} onChange={(e) => onEdit("subscription", "name", e.target.value)} />
                </Field>
                <Field label="金額">
                  <input inputMode="decimal" className={input} value={f.amount ?? ""} onChange={(e) => onEdit("subscription", "amount", e.target.value)} />
                </Field>
                <Field label="通貨">
                  <select className={input} value={String(f.currency)} onChange={(e) => onEdit("subscription", "currency", e.target.value)}>
                    <option value="JPY">円</option>
                    <option value="USD">ドル</option>
                  </select>
                </Field>
                <Field label="周期">
                  <select className={input} value={String(f.cycle)} onChange={(e) => onEdit("subscription", "cycle", e.target.value)}>
                    <option value="MONTHLY">毎月</option>
                    <option value="YEARLY">毎年</option>
                  </select>
                </Field>
                <Field label="請求日">
                  <input inputMode="numeric" className={input} value={f.day ?? ""} onChange={(e) => onEdit("subscription", "day", e.target.value)} />
                </Field>
                <Field label="開始日" className="col-span-2">
                  <input type="date" className={input} value={String(f.startDate ?? "")} onChange={(e) => onEdit("subscription", "startDate", e.target.value)} />
                </Field>
              </>
            )}
            {card.kind === "task" && (
              <>
                <Field label="題名" className="col-span-2">
                  <input className={input} value={String(f.title ?? "")} onChange={(e) => onEdit("task", "title", e.target.value)} />
                </Field>
                <Field label="期限" className="col-span-2">
                  <input type="date" className={input} value={String(f.due ?? "")} onChange={(e) => onEdit("task", "due", e.target.value)} />
                </Field>
                <Field label="メモ" className="col-span-2">
                  <textarea rows={2} className={input} value={String(f.memo ?? "")} onChange={(e) => onEdit("task", "memo", e.target.value)} />
                </Field>
              </>
            )}
            {card.kind === "event" && (
              <>
                <Field label="題名" className="col-span-2">
                  <input className={input} value={String(f.title ?? "")} onChange={(e) => onEdit("event", "title", e.target.value)} />
                </Field>
                <Field label="日付" className="col-span-2">
                  <input type="date" className={input} value={String(f.date ?? "")} onChange={(e) => onEdit("event", "date", e.target.value)} />
                </Field>
                <Field label="開始">
                  <input type="time" className={input} value={String(f.startTime ?? "")} onChange={(e) => onEdit("event", "startTime", e.target.value)} />
                </Field>
                <Field label="終了">
                  <input type="time" className={input} value={String(f.endTime ?? "")} onChange={(e) => onEdit("event", "endTime", e.target.value)} />
                </Field>
              </>
            )}
          </div>

          {card.kind === "payment" && (f.place === null || f.amount === null || f.date === null) && (
            <p className="text-[0.6875rem] text-danger">
              要確認: 本文から読み取れなかった項目があります。入力してください。
              {f.amount === null && f.originalAmount !== null && `（外貨建て ${f.originalCurrency} ${f.originalAmount}。金額は円に換算して入れてください）`}
            </p>
          )}

          {card.kind === "subscription" ? (
            <>
              <a
                href={subscriptionLink(card.fields)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => onOpenSubscription(card)}
                className="rounded-[10px] bg-accent px-3 py-2.5 text-center text-sm font-bold text-accent-foreground"
              >
                {meta.run}
              </a>
              <p className="text-[0.6875rem] text-muted">入力欄の内容は引き継がれません。Asset Managerのサブスク画面が開くだけなので（iPhoneのMorrowアプリではAsset Managerアプリで開きます）、登録はAsset Manager側で行ってください。</p>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={running || outcome?.done === true}
                onClick={() => onRun(card)}
                className="rounded-[10px] bg-accent px-3 py-2.5 text-sm font-bold text-accent-foreground transition-opacity disabled:opacity-50"
              >
                {running ? "実行しています…" : outcome?.done ? "実行済み" : meta.run}
              </button>
              <a href={app.url} target="_blank" rel="noopener noreferrer" className="text-center text-xs text-accent hover:underline">
                {app.label} ↗
              </a>
              <p className="text-center text-[0.6875rem] text-muted">開いても入力値は引き継がれません。</p>
            </>
          )}

          {outcome && (
            <p role={outcome.error ? "alert" : "status"} className={cn("text-xs", outcome.error ? "text-danger" : "text-muted")}>
              {outcome.text}
            </p>
          )}
        </div>
      )}
    </dialog>
  );
}
