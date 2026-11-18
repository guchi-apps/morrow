"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { WeatherIcon } from "@/components/weather/hourly-strip";
import { dayAtColumn, type DaySummary } from "@/lib/weather/day-summary";

const COLUMN_W = 46;
/** 「今」の位置からこれ以上離れたら「今の時間に戻る」を出す（px）。 */
const AWAY_PX = COLUMN_W;

const temp = (value: number | null) => (value === null ? "—" : `${Math.round(value)}°`);

function Diff({ diff }: { diff: string | null }) {
  if (diff === null) return null;
  return <span className="ml-1 text-xs font-normal text-muted">昨日比 {diff}</span>;
}

/**
 * 天気ページ上部の「表示中の日」の天気（#1078）。子の1時間ごとの帯（`data-strip-scroll`）を左右にスクロールすると、
 * 帯の表示幅の中央にある列の日へ切り替わる。「今」から離れたときだけ「今の時間に戻る」を出す。
 */
export function DaySummaryPanel({
  summaries,
  days,
  initialDate,
  resetKey,
  children,
}: {
  summaries: Record<string, DaySummary>;
  days: string[];
  initialDate: string;
  /** 地点・日付が変わったら状態を初期化する（帯の `resetKey` と同じ値）。 */
  resetKey: string;
  children: React.ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(initialDate);
  const [away, setAway] = useState(false);

  const sync = useCallback(() => {
    const box = root.current?.querySelector<HTMLElement>("[data-strip-scroll]");
    const first = box?.querySelector<HTMLElement>("[data-hour]");
    if (!box || !first) return;
    const center = box.scrollLeft + box.clientWidth / 2 - first.offsetLeft;
    setActive(dayAtColumn(days, Math.floor(center / COLUMN_W)));
    const now = box.querySelector<HTMLElement>("[data-now]");
    setAway(now ? Math.abs(box.scrollLeft - Math.max(0, now.offsetLeft - COLUMN_W)) > AWAY_PX : false);
  }, [days]);

  useEffect(() => {
    const box = root.current?.querySelector<HTMLElement>("[data-strip-scroll]");
    if (!box) return;
    sync();
    box.addEventListener("scroll", sync, { passive: true });
    return () => box.removeEventListener("scroll", sync);
  }, [sync, resetKey]);

  const backToNow = () => {
    const box = root.current?.querySelector<HTMLElement>("[data-strip-scroll]");
    const now = box?.querySelector<HTMLElement>("[data-now]");
    if (!box || !now) return;
    box.scrollTo({ left: Math.max(0, now.offsetLeft - COLUMN_W), behavior: "smooth" });
  };

  const summary = summaries[active] ?? summaries[initialDate];

  return (
    <div ref={root} className="flex min-w-0 flex-col gap-2.5">
      {summary && (
        <div className="flex flex-col gap-1.5" aria-live="polite">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted">{summary.label}</span>
            {away && (
              <button
                type="button"
                onClick={backToNow}
                className="rounded-full border border-border bg-background px-3 py-1 text-xs font-bold text-foreground hover:bg-rail-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                今の時間に戻る
              </button>
            )}
          </div>
          <div className="flex items-center gap-3.5">
            <WeatherIcon code={summary.code} className="size-14 shrink-0 text-topic" />
            <div className="flex flex-col">
              <span className="text-2xl font-bold leading-tight">{summary.condition}</span>
              {summary.pop !== null && <span className="text-sm text-muted">降水確率 {summary.pop}%</span>}
            </div>
          </div>
          <p className="text-[0.9375rem] tabular-nums">
            最高 <b className="text-accent">{temp(summary.max)}</b>
            <Diff diff={summary.maxDiff} />
            <span className="mx-1.5 text-muted">/</span>
            最低 <b className="text-topic">{temp(summary.min)}</b>
            <Diff diff={summary.minDiff} />
          </p>
        </div>
      )}
      {children}
    </div>
  );
}
