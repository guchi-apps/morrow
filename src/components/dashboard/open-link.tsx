"use client";

import Link from "next/link";

import { isExternalNoticeUrl } from "@/lib/notice-url";

/**
 * 選ばれた時刻。「いつ時点の話か」が分かると、古い報せを新しい話と読まずに済む。
 */
export function noticeStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/**
 * 押したときに開く先（#137）。お知らせがリンクを持っている回だけ出す。
 *
 * 別のアプリのページは新しいタブで開く（`target="_blank"`）。アプリの中のパスは
 * `next/link` で同じタブのまま移る。
 */
export function OpenLink({ url }: { url: string }) {
  const label = "元のページを開く";
  const className =
    "inline-flex shrink-0 items-center gap-1 rounded-full border border-accent/45 bg-surface px-2.5 py-0.5 text-[0.6875rem] font-bold text-accent no-underline";

  const inner = (
    <>
      開く
      <svg
        viewBox="0 0 24 24"
        className="size-2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M7 17 17 7" />
        <path d="M9 7h8v8" />
      </svg>
    </>
  );

  if (isExternalNoticeUrl(url)) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" aria-label={label} className={className}>
        {inner}
      </a>
    );
  }

  return (
    <Link href={url} aria-label={label} className={className}>
      {inner}
    </Link>
  );
}
