"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { HEADER_ICON_BUTTON, useHeaderSlot } from "@/components/chat/header-actions";

/**
 * ヘッダー右上のアイコンで開くモーダル（#956。`MailCriteriaDialog`〔#951〕と同じ作りの汎用版）。
 * 中身はサーバー側から子として受け取る。開閉は `FlowSheet` と同じ `<dialog>` の `showModal()`。
 * 開いている間だけ中身を描くので、開くたびに最新の値で初期化される。
 */
export function HeaderDialog({
  icon,
  label,
  summary,
  badge,
  children,
}: {
  /**
   * 描画済みのアイコン要素（例: `<Clock className="size-4" aria-hidden="true" />`）。
   * サーバーコンポーネントから使うので、コンポーネント（関数）そのものは渡せない（#977）。
   */
  icon: ReactNode;
  label: string;
  /** モーダル見出しの下とアイコンのtitleに出す状態の要約。 */
  summary: string;
  /** アイコン右上の数字。0・未指定なら出さない。 */
  badge?: number;
  children: ReactNode;
}) {
  const slot = useHeaderSlot();
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const button = (
    <button type="button" onClick={() => setOpen(true)} aria-label={label} title={`${label}（${summary}）`} aria-haspopup="dialog" className={HEADER_ICON_BUTTON}>
      {icon}
      {badge !== undefined && badge > 0 && (
        <span aria-hidden="true" className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-accent px-1 text-[0.625rem] font-bold leading-4 text-accent-foreground">
          {badge}
        </span>
      )}
    </button>
  );

  return (
    <>
      {slot ? createPortal(button, slot) : button}
      <dialog
        ref={ref}
        aria-label={label}
        onClose={() => setOpen(false)}
        onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
        className="fixed inset-x-0 bottom-[var(--keyboard-inset)] top-auto m-0 mx-auto max-h-[min(85dvh,calc(var(--app-height)-1rem))] w-full max-w-[560px] overflow-y-auto rounded-t-[18px] border border-border bg-surface p-0 text-foreground backdrop:bg-black/55 md:inset-y-0 md:my-auto md:h-fit md:rounded-[18px]"
      >
        <div className="flex flex-col gap-3.5 px-4 pb-[calc(1.25rem+var(--app-bottom-inset))] pt-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-col">
              <h2 className="text-[0.9375rem] font-bold">{label}</h2>
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
