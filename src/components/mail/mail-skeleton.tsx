import { Bar, LoadingLabel } from "@/components/ui/page-skeleton";

import { MailBackLinkFromQuery } from "./mail-back-link";

const BODY_LINES = ["w-[96%]", "w-[88%]", "w-[92%]", "w-[70%]", null, "w-[94%]", "w-[82%]", "w-[60%]"];

/**
 * 本文を取得している間の形（#699）。並びは本文の画面（`/mail/[id]/page.tsx`）に揃えてあり、
 * 届いたときに位置がずれない。
 */
export function MailDetailSkeleton() {
  return (
    <div className="mobile-tab-pad min-h-0 flex-1 overflow-y-auto">
      <MailBackLinkFromQuery />
      <div className="mx-auto flex w-full max-w-[900px] flex-col gap-3.5 px-3.5 py-4 md:px-7 md:py-6">
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="flex flex-col gap-2 px-4 py-4">
            <Bar className="h-5 w-[62%]" />
            <Bar className="mt-1 h-3 w-[40%]" />
            <Bar className="h-3 w-[32%]" />
            <Bar className="h-3 w-[26%]" />
          </div>
          <div className="flex flex-col gap-2.5 border-t border-border px-4 py-4">
            <LoadingLabel>本文を読み込んでいます</LoadingLabel>
            {BODY_LINES.map((width, index) =>
              width ? <Bar key={index} className={`h-3 ${width}`} /> : <div key={index} className="h-1.5" />,
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const ROW_WIDTHS = ["w-[72%]", "w-[58%]", "w-[80%]", "w-[64%]", "w-[76%]", "w-[52%]"];

/** 一覧を取得している間の形（#699）。見出しと行だけを描く。 */
export function MailListSkeleton() {
  return (
    <div className="mobile-tab-pad min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[900px] flex-col gap-3.5 px-3.5 pb-4 md:px-7 md:pb-6">
        {/* 一覧の画面の固定部分（表示切替＋検索。#997）と同じ高さ・並び */}
        <div className="-mx-3.5 flex flex-col gap-2 border-b border-border px-3.5 pb-2.5 pt-3 md:-mx-7 md:px-7 md:pt-5">
          <div className="flex items-center justify-between gap-3">
            <Bar className="h-7 w-[230px] rounded-full" />
            <LoadingLabel>メールを読み込んでいます</LoadingLabel>
          </div>
          <Bar className="h-[30px] w-full rounded-[9px]" />
        </div>
        <MailRowsSkeleton />
      </div>
    </div>
  );
}

/** 一覧の行だけのスケルトン。表示切替を押した直後に、固定部分は残して一覧だけへ差し込む（#1053）。 */
export function MailRowsSkeleton() {
  return (
    <ul className="overflow-hidden rounded-xl border border-border bg-surface" aria-hidden="true">
      {ROW_WIDTHS.map((width, index) => (
        <li key={index} className="flex items-center gap-2.5 border-t border-border px-3 py-3 first:border-t-0 md:px-3.5">
          <Bar className="size-4 shrink-0 rounded" />
          <div className="grid min-w-0 flex-1 gap-1.5 md:grid-cols-[170px_1fr_auto] md:items-center md:gap-3">
            <Bar className="h-3.5 w-[60%] md:w-[120px]" />
            <Bar className={`h-3 ${width}`} />
            <Bar className="hidden h-3 w-10 md:block" />
          </div>
        </li>
      ))}
    </ul>
  );
}
