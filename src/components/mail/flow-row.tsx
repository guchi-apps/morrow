"use client";

import { KIND_META } from "@/components/mail/flow-sheet";
import { itemsTotal } from "@/lib/mail/payment-receipt";
import type { ReceiptState } from "@/lib/mail/flow-record-core";
import type { Suggestion } from "@/lib/mail/suggest-core";
import { cn } from "@/lib/utils";

/** 提案の1行（#766）。押すとハーフモーダルが開く。分析と指示の返事（#784）の両方で使う。型だけをimportする。 */
export function FlowRowButton({ card, recommended, registered, receipt = null, onOpen }: { card: Suggestion; recommended: boolean; registered: boolean; receipt?: ReceiptState | null; onOpen: () => void }) {
  const meta = KIND_META[card.kind];
  const preview = cardPreview(card);
  return (
    <button
      type="button"
      onClick={onOpen}
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
          {!registered && receipt && <span className="rounded-full bg-accent-surface px-2 py-0.5 text-[0.625rem] font-bold text-accent">{receipt === "pending" ? "確認待ち" : "取り込み済み"}</span>}
        </span>
        {preview && <span className="truncate opacity-85">{preview}</span>}
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
  );
}

/** 提案の行に出す、読み取った値の短い並び（「関西電力・7,842円・11/5」）。 */
function cardPreview(card: Suggestion): string {
  const day = (value: string | null) => (value ? `${Number(value.slice(5, 7))}/${Number(value.slice(8, 10))}` : null);
  const parts: (string | null)[] =
    card.kind === "payment"
      ? [
          card.fields.place,
          // 品目に分かれていれば件数（#781）。合計が無ければ品目の合計
          card.fields.items.length > 1 ? `${card.fields.items.length}品目` : card.fields.items[0]?.name || card.fields.name,
          (card.fields.amount ?? itemsTotal(card.fields.items)) !== null ? `${(card.fields.amount ?? itemsTotal(card.fields.items))!.toLocaleString("ja-JP")}円` : null,
          day(card.fields.date),
        ]
      : card.kind === "subscription"
        ? [card.fields.name, card.fields.amount !== null ? `${card.fields.amount.toLocaleString("ja-JP")}${card.fields.currency === "USD" ? "ドル" : "円"}` : null, card.fields.cycle === "YEARLY" ? "毎年" : "毎月"]
        : card.kind === "task"
          ? [card.fields.title, card.fields.due ? `期限 ${day(card.fields.due)}` : null]
          : [card.fields.title, day(card.fields.date), card.fields.startTime ? `${card.fields.startTime}〜${card.fields.endTime ?? ""}` : null];
  return parts.filter((part): part is string => Boolean(part)).join("・");
}
