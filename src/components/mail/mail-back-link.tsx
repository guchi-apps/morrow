"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { safeMailBack } from "@/lib/mail/back-path";

import { leaveMailPane } from "./mail-transition";

/** 「← 一覧へ戻る」。押すと本文の画面が右へ少し退き、一覧が左から戻る（#699）。 */
export function MailBackLink({ href }: { href: string }) {
  return (
    <Link href={href} onClick={(event) => leaveMailPane(event, "back")} className="self-start text-xs text-accent hover:underline">
      ← 一覧へ戻る
    </Link>
  );
}

/** 読み込み中のスケルトン用。戻り先は本文の画面と同じく `?back=` から決める。 */
export function MailBackLinkFromQuery() {
  const back = useSearchParams().get("back");
  return <MailBackLink href={safeMailBack(back)} />;
}
