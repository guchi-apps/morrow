import { MailBackLinkFromQuery } from "./mail-back-link";

/** スケルトンの帯1本。 */
function Bar({ className }: { className: string }) {
  return <div className={`mail-skeleton ${className}`} aria-hidden="true" />;
}

/** 「◯◯を読み込んでいます」。読み上げにも状態を伝える。 */
function LoadingLabel({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="flex items-center gap-2 text-[0.6875rem] text-muted">
      <span className="mail-loading-dots flex gap-1" aria-hidden="true">
        <span className="size-1.5 rounded-full bg-accent" />
        <span className="size-1.5 rounded-full bg-accent" />
        <span className="size-1.5 rounded-full bg-accent" />
      </span>
      {children}
    </p>
  );
}

const BODY_LINES = ["w-[96%]", "w-[88%]", "w-[92%]", "w-[70%]", null, "w-[94%]", "w-[82%]", "w-[60%]"];

/**
 * 本文を取得している間の形（#699）。並びは本文の画面（`/mail/[id]/page.tsx`）に揃えてあり、
 * 届いたときに位置がずれない。
 */
export function MailDetailSkeleton() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[900px] flex-col gap-3.5 px-3.5 py-4 md:px-7 md:py-6">
        <MailBackLinkFromQuery />
        <div className="flex flex-wrap gap-1.5" aria-hidden="true">
          <Bar className="h-[30px] w-[78px] rounded-[9px]" />
          <Bar className="h-[30px] w-[84px] rounded-[9px]" />
          <Bar className="h-[30px] w-[70px] rounded-[9px]" />
          <Bar className="h-[30px] w-[72px] rounded-[9px]" />
        </div>
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
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[900px] flex-col gap-3.5 px-3.5 py-4 md:px-7 md:py-6">
        <div className="flex items-baseline justify-between gap-3">
          <Bar className="h-5 w-24" />
          <LoadingLabel>メールを読み込んでいます</LoadingLabel>
        </div>
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
      </div>
    </div>
  );
}
