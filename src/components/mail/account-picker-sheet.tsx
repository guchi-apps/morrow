"use client";

import { useEffect, useRef } from "react";

/**
 * 引き落とし口座を選ぶハーフモーダル（#921）。残高の口座は20件ほどになるので、カード上にチップで並べず縦の一覧で出す。
 * 開閉・背景タップで閉じる作りは `FlowSheet` と同じ（`<dialog>` の `showModal()`）。選ぶと閉じて `onPick` を呼ぶ。
 */
export function AccountPickerSheet({ open, choices, busy, onPick, onClose }: { open: boolean; choices: string[]; busy: boolean; onPick: (account: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label="引き落とし口座を選ぶ"
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
      className="flow-sheet fixed inset-x-0 bottom-0 top-auto m-0 mx-auto max-h-[85dvh] w-full max-w-[560px] overflow-y-auto rounded-t-[18px] border border-border bg-surface p-0 text-foreground backdrop:bg-black/55"
    >
      {open && (
        <div className="flex flex-col gap-2 px-4 pb-[calc(1.25rem+var(--app-bottom-inset))] pt-2">
          <div aria-hidden className="mx-auto h-[5px] w-10 rounded-full bg-border" />
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[0.9375rem] font-bold">🏦 引き落とし口座を選ぶ</h2>
            <button type="button" onClick={() => ref.current?.close()} aria-label="閉じる" className="rounded-md px-2 py-1 text-lg leading-none text-muted hover:bg-rail-active">
              ✕
            </button>
          </div>
          <p className="text-[0.6875rem] text-muted">選ぶと閉じて、その口座の残高で確認します。</p>
          <ul>
            {choices.map((name) => (
              <li key={name} className="border-b border-border last:border-b-0">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    ref.current?.close();
                    onPick(name);
                  }}
                  className="w-full px-2 py-3 text-left text-sm font-semibold transition-colors hover:bg-rail-active disabled:opacity-60"
                >
                  {name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </dialog>
  );
}
