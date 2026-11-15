"use client";

import { Archive } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

import { safeMailBack } from "@/lib/mail/back-path";

/**
 * 本文の画面の上端に固定するバー（#987。#970の下部固定バーから移した）。左に「← 一覧へ戻る」（動きは付けずにすぐ戻る。#967）、
 * アーカイブ済みなら隣にバッジ、右端に `children`（既読/未読・アーカイブのアイコン。`MailDetailActions`）。
 * スクロール領域の先頭に置き、`sticky` で画面上端（ヘッダー直下）に留める。
 */
export function MailBackLink({ href, archived = false, children }: { href: string; archived?: boolean; children?: ReactNode }) {
  return (
    <div className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex min-h-[52px] w-full max-w-[900px] items-center gap-2 px-3.5 py-1.5 md:px-7">
        <Link href={href} className="py-2 text-xs text-accent hover:underline">
          ← 一覧へ戻る
        </Link>
        {archived && (
          <span className="inline-flex items-center gap-1 rounded-full bg-border px-2.5 py-0.5 text-[11px] font-semibold text-muted">
            <Archive className="size-3" aria-hidden="true" />
            アーカイブ済み
          </span>
        )}
        {children && <div className="ml-auto flex items-center gap-2">{children}</div>}
      </div>
    </div>
  );
}

/** 読み込み中のスケルトン用。戻り先は本文の画面と同じく `?back=` から決める。 */
export function MailBackLinkFromQuery() {
  const back = useSearchParams().get("back");
  return <MailBackLink href={safeMailBack(back)} />;
}
