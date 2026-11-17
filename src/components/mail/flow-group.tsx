"use client";

import { useState } from "react";

import { FlowRowButton } from "@/components/mail/flow-row";
import type { FlowCards, FlowRow } from "@/components/mail/use-flow-cards";
import type { ReceiptState } from "@/lib/mail/flow-record-core";
import { bulkResultText, groupHeading, isBulkKind } from "@/lib/mail/flow-group";
import { cn } from "@/lib/utils";

/**
 * 提案の行の並び（分析 #766・指示 #784）。候補が2件以上なら1つのグループに囲み、タスク・予定の行にチェックを付けて
 * 「選んだN件をまとめて登録」できるようにする（#1051）。1件だけなら従来どおり行だけを出す。
 * 値を直したいときは従来どおり行を押してシート（`FlowSheet`）で直す。直した値はまとめて登録にもそのまま使われる。
 */
export function FlowRowList({
  rowIds,
  flow,
  registeredOf,
  receiptOf,
  label,
}: {
  rowIds: string[];
  flow: FlowCards;
  /** 控えなど、この画面の外で登録済みと分かっているか（画面で登録した結果は別に見る）。 */
  registeredOf?: (row: FlowRow) => boolean;
  receiptOf?: (row: FlowRow) => ReceiptState | null;
  label?: string;
}) {
  /** チェックを外した行（既定は全部選ぶ）。 */
  const [unchecked, setUnchecked] = useState<Set<string>>(() => new Set());
  const [result, setResult] = useState<{ text: string; error: boolean } | null>(null);

  const items = rowIds.flatMap((rowId) => {
    const row = flow.rows[rowId];
    if (!row) return [];
    const outcome = flow.outcomes[rowId];
    const registered = (outcome?.done === true && !outcome.receipt) || (registeredOf?.(row) ?? false);
    return [{ rowId, row, outcome, registered }];
  });

  const rowButton = ({ rowId, row, outcome, registered }: (typeof items)[number]) => (
    <FlowRowButton
      card={row.card}
      recommended={row.recommended}
      registered={registered}
      receipt={outcome?.receipt ?? receiptOf?.(row) ?? null}
      match={flow.matches[rowId]}
      onOpen={() => flow.setOpen(rowId)}
    />
  );

  if (items.length < 2) {
    return (
      <ul aria-label={label} className="flex flex-col gap-1.5">
        {items.map((item) => (
          <li key={item.rowId}>{rowButton(item)}</li>
        ))}
      </ul>
    );
  }

  const eligible = items.filter((item) => isBulkKind(item.row.card.kind) && !item.registered);
  const selected = eligible.filter((item) => !unchecked.has(item.rowId));
  const busy = flow.bulkRunning || flow.running !== null;

  async function runSelected() {
    if (selected.length === 0 || busy) return;
    setResult(null);
    const results = await flow.runMany(selected.map((item) => item.rowId));
    if (results.length > 0) setResult(bulkResultText(results));
  }

  function toggle(rowId: string) {
    setUnchecked((current) => {
      const next = new Set(current);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 border-b border-border bg-surface px-2.5 py-1.5 text-[0.6875rem] text-muted">
        <span className="font-bold text-foreground">{groupHeading(items.map((item) => item.row.card))}</span>
        <span>行を押すと値を確かめて直せます</span>
      </div>
      <ul aria-label={label} className="flex flex-col gap-1.5 p-1.5">
        {items.map((item) => {
          const bulk = isBulkKind(item.row.card.kind) && !item.registered;
          const checked = bulk && !unchecked.has(item.rowId);
          const outcome = item.outcome;
          return (
            <li key={item.rowId} className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                {/* まとめて登録の対象外（家計簿・サブスク・追跡・紐づけ・登録済み）は、行の位置を揃えるために空きだけ置く */}
                <span className="flex w-6 shrink-0 justify-center">
                  {bulk && (
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={busy}
                      onChange={() => toggle(item.rowId)}
                      aria-label={`まとめて登録に含める: ${item.row.card.kind === "task" ? "タスク" : "予定"}`}
                      className="size-4.5 accent-accent"
                    />
                  )}
                </span>
                <div className="min-w-0 flex-1">{rowButton(item)}</div>
              </div>
              {flow.running === item.rowId && flow.bulkRunning && <p className="pl-7.5 text-[0.6875rem] text-muted">登録しています…</p>}
              {outcome && flow.bulkRunning === false && outcome.error && <p className="pl-7.5 text-[0.6875rem] text-danger">{outcome.text}</p>}
            </li>
          );
        })}
      </ul>
      {(eligible.length > 0 || result) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface px-2.5 py-2">
          {result ? (
            <p role="status" className={cn("text-xs", result.error ? "text-danger" : "text-fair")}>
              {result.error ? "" : "✓ "}
              {result.text}
            </p>
          ) : (
            <p className="text-[0.6875rem] text-muted">チェックした行だけ登録します（家計簿・サブスク・追跡は行から1件ずつ）</p>
          )}
          {eligible.length > 0 && (
            <button
              type="button"
              disabled={busy || selected.length === 0}
              onClick={() => void runSelected()}
              className="shrink-0 rounded-[10px] bg-accent px-3.5 py-2 text-xs font-bold text-accent-foreground disabled:opacity-50"
            >
              {flow.bulkRunning ? "登録しています…" : `選んだ${selected.length}件をまとめて登録`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
