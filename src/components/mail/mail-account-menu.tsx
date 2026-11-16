"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { HEADER_ICON_BUTTON, useHeaderSlot } from "@/components/chat/header-actions";
import { mailAccountTone } from "@/lib/mail/contract";
import { cn } from "@/lib/utils";

import { ACCOUNT_TONE_CLASS } from "./mail-account-chip";

export type MailAccountMenuItem = {
  key: string;
  name: string;
  /** いま表示しているか。 */
  on: boolean;
  /** 押した後の一覧のURL（表示・検索語は引き継ぐ。最後の1つを外す操作は今の選択のまま）。 */
  href: string;
};

type Props = {
  items: MailAccountMenuItem[];
  /** 取得できなかったアカウントの名前（鍵ではなく表示名）。 */
  failedNames: string[];
};

/**
 * 表示するアカウントの切り替え（#997。以前は本文のチップ行〔#711・#829〕）。
 * ヘッダー右上の「いま確認」の右に、各アカウントの色の点を並べたアイコンを出す（外したアカウントは輪だけ）。
 * 押すとアイコンの下にメニューが開き、アカウントごとに表示／非表示を切り替える（複数選択・最後の1つは外せない）。
 * 各項目はリンクなので、選択はこれまでどおりURL（`?acct=`）に載る。
 */
export function MailAccountMenu({ items, failedNames }: Props) {
  const slot = useHeaderSlot();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const shown = items.filter((item) => item.on).map((item) => item.name);
  const summary = shown.length === items.length ? "すべて表示中" : `${shown.join("・")}を表示中`;
  const failed = failedNames.length > 0;

  const menu = (
    // 置き場は flex。並びは「いま確認」→ アカウント → お知らせする基準（order で固定。描画の順序に頼らない）
    <div ref={rootRef} className="relative order-1">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="表示するアカウント"
        title={`表示するアカウント（${summary}）`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className={cn(HEADER_ICON_BUTTON, open && "bg-rail-active")}
      >
        <span aria-hidden="true" className="flex w-[20px] flex-wrap justify-center gap-[2px]">
          {items.map((item) => {
            const tone = ACCOUNT_TONE_CLASS[mailAccountTone(item.key)];
            return <i key={item.key} className={cn("size-[8px] rounded-full", item.on ? tone.dot : cn("border-2", tone.ring))} />;
          })}
        </span>
        {failed && <span aria-hidden="true" className="absolute -right-1 -top-1 size-2.5 rounded-full border-2 border-surface bg-danger" />}
      </button>

      {open && (
        <div
          id={menuId}
          role="group"
          aria-label="表示するアカウント"
          className="absolute right-0 top-[calc(100%+8px)] z-40 flex w-[250px] flex-col rounded-[14px] border border-border bg-surface p-2.5 text-sm text-foreground shadow-[0_12px_30px_rgba(0,0,0,0.35)]"
        >
          <p className="px-1 pb-2 pt-0.5 text-[0.8125rem] font-bold">表示するアカウント</p>
          {items.map((item) => {
            const tone = ACCOUNT_TONE_CLASS[mailAccountTone(item.key)];
            const onlyOne = item.on && items.filter((other) => other.on).length === 1;
            return (
              <Link
                key={item.key}
                href={item.href}
                onClick={() => setOpen(false)}
                aria-pressed={item.on}
                aria-disabled={onlyOne ? true : undefined}
                className={cn("flex items-center gap-2.5 rounded-[9px] px-2 py-2.5 transition-colors hover:bg-rail-active", item.on && "bg-rail-active/60")}
              >
                <i aria-hidden="true" className={cn("size-3 shrink-0 rounded-full", item.on ? tone.dot : cn("border-2", tone.ring))} />
                <span className={cn("flex-1", !item.on && "text-muted")}>{item.name}</span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid size-[18px] place-items-center rounded-[5px] text-xs font-bold",
                    item.on ? cn(tone.dot, "text-background") : "border-[1.5px] border-muted",
                  )}
                >
                  {item.on ? "✓" : ""}
                </span>
              </Link>
            );
          })}
          {failed && <p className="px-2 pb-1 pt-1.5 text-[0.6875rem] text-danger">取得できなかったアカウント: {failedNames.join("、")}</p>}
          <p className="mt-1 border-t border-border px-2 pt-2 text-[0.6875rem] text-muted">押すたびに表示／非表示を切り替えます（最後の1つは外せません）</p>
        </div>
      )}
    </div>
  );

  return slot ? createPortal(menu, slot) : menu;
}
