"use client";

import { Archive } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { safeMailBack } from "@/lib/mail/back-path";

/** 「← 一覧へ戻る」。動きを付けずにすぐ一覧へ戻る（#967）。アーカイブ済みのメールでは右にバッジを出す（#970）。 */
export function MailBackLink({ href, archived = false }: { href: string; archived?: boolean }) {
  return (
    <div className="flex items-center gap-2 self-start">
      <Link href={href} className="text-xs text-accent hover:underline">
        ← 一覧へ戻る
      </Link>
      {archived && (
        <span className="inline-flex items-center gap-1 rounded-full bg-border px-2.5 py-0.5 text-[11px] font-semibold text-muted">
          <Archive className="size-3" aria-hidden="true" />
          アーカイブ済み
        </span>
      )}
    </div>
  );
}

/** 読み込み中のスケルトン用。戻り先は本文の画面と同じく `?back=` から決める。 */
export function MailBackLinkFromQuery() {
  const back = useSearchParams().get("back");
  return <MailBackLink href={safeMailBack(back)} />;
}
