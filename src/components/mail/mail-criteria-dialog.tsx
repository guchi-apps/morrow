"use client";

import { SlidersHorizontal } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { HEADER_ICON_BUTTON, useHeaderSlot } from "@/components/chat/header-actions";

/**
 * 「お知らせする基準」（#951）。ヘッダー右上のアイコンで開くモーダル。
 * 中身（基準の編集・学習した傾向）はサーバー側から子として受け取る。開閉は `FlowSheet` と同じ `<dialog>` の `showModal()`。
 */
export function MailCriteriaDialog({ learnedCount, custom, children }: { learnedCount: number; custom: boolean; children: ReactNode }) {
  const slot = useHeaderSlot();
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const summary = `${custom ? "設定済み" : "既定の基準"}${learnedCount > 0 ? `・学習した傾向 ${learnedCount}件` : ""}`;
  const button = (
    <button type="button" onClick={() => setOpen(true)} aria-label="お知らせする基準" title={`お知らせする基準（${summary}）`} aria-haspopup="dialog" className={`${HEADER_ICON_BUTTON} order-2`}>
      <SlidersHorizontal className="size-4" aria-hidden="true" />
      {learnedCount > 0 && (
        <span aria-hidden="true" className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-accent px-1 text-[0.625rem] font-bold leading-4 text-accent-foreground">
          {learnedCount}
        </span>
      )}
    </button>
  );

  return (
    <>
      {slot ? createPortal(button, slot) : button}
      <dialog
        ref={ref}
        aria-label="お知らせする基準"
        onClose={() => setOpen(false)}
        onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
        className="fixed inset-x-0 bottom-0 top-auto m-0 mx-auto max-h-[85dvh] w-full max-w-[560px] overflow-y-auto rounded-t-[18px] border border-border bg-surface p-0 text-foreground backdrop:bg-black/55 md:inset-y-0 md:my-auto md:h-fit md:rounded-[18px]"
      >
        <div className="flex flex-col gap-3.5 px-4 pb-[calc(1.25rem+var(--app-bottom-inset))] pt-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-col">
              <h2 className="text-[0.9375rem] font-bold">お知らせする基準</h2>
              <span className="text-[0.6875rem] text-muted">{summary}</span>
            </div>
            <button type="button" onClick={() => ref.current?.close()} aria-label="閉じる" className="rounded-md px-2 py-1 text-lg leading-none text-muted hover:bg-rail-active">
              ✕
            </button>
          </div>
          {open && children}
        </div>
      </dialog>
    </>
  );
}
