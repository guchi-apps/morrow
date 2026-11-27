"use client";

import { ImageOff, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * 自分の発言に出す、送った画像（#1219）。押すと `<dialog>` で全画面に拡大する（新しいタブは開かない。iOSの殻でも同じ）。
 * 画像は画面のメモリにだけある `data:` URL で、再読み込み・履歴の復元では無いので、枚数だけの注記を出す。
 */
export function SentImages({ srcs, count }: { srcs?: string[]; count?: number }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!srcs || srcs.length === 0) {
    if (!count) return null;
    return (
      <p className="flex items-center gap-1.5 rounded-xl border border-dashed border-border bg-surface px-2.5 py-1.5 text-[11px] text-muted">
        <ImageOff className="size-3.5" aria-hidden="true" />
        画像 {count} 枚（再読み込みしたため表示できません）
      </p>
    );
  }
  const single = srcs.length === 1;
  return (
    <>
      <ul className="flex flex-wrap justify-end gap-1.5" aria-label={`送った画像 ${srcs.length} 枚`}>
        {srcs.map((src, index) => (
          <li key={index}>
            <button
              type="button"
              onClick={() => setOpen(index)}
              aria-label={`送った画像 ${index + 1} を拡大する`}
              className={`block cursor-zoom-in overflow-hidden rounded-xl border border-border bg-surface ${
                single ? "h-40 w-56 sm:h-44 sm:w-60" : "size-26 sm:size-32"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={`送った画像 ${index + 1}`} className="size-full object-cover" />
            </button>
          </li>
        ))}
      </ul>
      {open !== null && srcs[open] && <ImageViewer src={srcs[open]} label={`送った画像 ${open + 1} / ${srcs.length}`} onClose={() => setOpen(null)} />}
    </>
  );
}

function ImageViewer({ src, label, onClose }: { src: string; label: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={label}
      onClose={onClose}
      onClick={(event) => {
        // 画像の外（背景）を押したら閉じる
        if (event.target === event.currentTarget) ref.current?.close();
      }}
      className="m-0 h-dvh max-h-none w-screen max-w-none bg-black/85 p-0 backdrop:bg-black/60"
    >
      <div
        className="flex size-full flex-col items-center justify-center gap-3 p-4"
        onClick={(event) => {
          if (event.target === event.currentTarget) ref.current?.close();
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={label} className="max-h-[85dvh] max-w-full rounded-md object-contain" />
        <p className="text-xs text-neutral-300">{label}</p>
      </div>
      <button
        type="button"
        onClick={() => ref.current?.close()}
        aria-label="閉じる"
        className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] inline-flex size-9 items-center justify-center rounded-full bg-white/20 text-white"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </dialog>
  );
}
