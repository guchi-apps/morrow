import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Sun,
} from "lucide-react";

import { ScrollToNow } from "@/components/dashboard/scroll-to-now";
import type { HourCell } from "@/lib/dashboard/places";
import { compareWithYesterday, describeDiff } from "@/lib/dashboard/temperature-diff";
import { describeWeatherCode, RAIN_POP } from "@/lib/weather/rain-check";
import { cn } from "@/lib/utils";

/**
 * 天気の部品（ダッシュボードと天気ページ（#695）で共有する）。1時間ごとの帯・気温の折れ線・天気アイコン。
 * サーバーコンポーネントのまま置く（`ScrollToNow` だけがクライアント）。
 */

/** 天気コード（WMO）→ アイコン。表の区切りは `describeWeatherCode()` と同じ。 */
export function WeatherIcon({ code, className }: { code: number | null; className?: string }) {
  const Icon =
    code === null
      ? Cloud
      : code <= 1
        ? Sun
        : code === 2
          ? CloudSun
          : code === 3
            ? Cloud
            : code <= 48
              ? CloudFog
              : code <= 57
                ? CloudDrizzle
                : code <= 67 || (code >= 80 && code <= 82)
                  ? CloudRain
                  : code <= 86
                    ? CloudSnow
                    : CloudLightning;
  return <Icon className={className} aria-hidden="true" />;
}

const BAND_CLASS: Record<HourCell["placeKind"], string> = {
  home: "border border-border bg-background text-muted",
  away: "bg-accent-surface text-accent",
  move: "border border-dashed border-border font-normal text-muted",
};

/** 気温グラフの凡例と昨日との差の一行（#651）。昨日の値が1つも無ければ何も出さない。 */
export function YesterdayNote({ cells, nowIndex }: { cells: HourCell[]; nowIndex: number }) {
  if (!cells.some((cell) => cell.yesterday !== null)) return null;
  // 差の一行は「いま」がある日（今日）だけ。ほかの日は凡例だけ出す。
  const diff = nowIndex >= 0 ? compareWithYesterday(cells.map((cell, index) => (index === nowIndex ? cell : { ...cell, yesterday: null })), nowIndex) : null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted">
      {diff && <span className="font-bold text-foreground">{describeDiff(diff, true)}</span>}
      <span className="inline-flex items-center gap-1">
        <i className="inline-block w-5 border-t-2 border-topic" aria-hidden="true" />今日
      </span>
      <span className="inline-flex items-center gap-1">
        <i className="inline-block w-5 border-t-2 border-topic/25" aria-hidden="true" />昨日
      </span>
    </div>
  );
}

const CELL_W = 46;
const CHART_H = 64;
const CHART_PAD_TOP = 18;
const CHART_PAD_BOTTOM = 8;

/** 気温の折れ線（#609）。全列にまたがる1枚のSVGで、各点の上に値を出す。過ぎた時間（`nowIndex` より前）は灰色。 */
export function TemperatureChart({ cells, nowIndex }: { cells: HourCell[]; nowIndex: number }) {
  const temps = cells.flatMap((cell) => (cell.temperature === null ? [] : [cell.temperature]));
  if (temps.length === 0) return null;
  const yesterdayTemps = cells.flatMap((cell) => (cell.yesterday === null ? [] : [cell.yesterday]));
  // 縦軸は昨日ぶんも含めて決める（差が高さの差として見える。#651）
  const min = Math.min(...temps, ...yesterdayTemps);
  const max = Math.max(...temps, ...yesterdayTemps);
  const span = max - min;
  const y = (t: number) =>
    span === 0 ? CHART_H / 2 : CHART_PAD_TOP + ((max - t) / span) * (CHART_H - CHART_PAD_TOP - CHART_PAD_BOTTOM);
  const points = cells.map((cell, index) =>
    cell.temperature === null ? null : { index, x: index * CELL_W + CELL_W / 2, y: y(cell.temperature), t: cell.temperature },
  );
  // 欠けた時間で線を切る。過去と未来は「今」の点で繋ぎ、色だけ分ける。
  const pathOf = (from: number, to: number) => {
    let d = "";
    let pen = false;
    for (const point of points.slice(from, to + 1)) {
      if (!point) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${point.x} ${point.y}`;
      pen = true;
    }
    return d;
  };
  const yesterdayPath = (() => {
    let d = "";
    let pen = false;
    cells.forEach((cell, index) => {
      if (cell.yesterday === null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${index * CELL_W + CELL_W / 2} ${y(cell.yesterday)}`;
      pen = true;
    });
    return d;
  })();
  const split = nowIndex >= 0 ? nowIndex : 0;
  return (
    <svg width={cells.length * CELL_W} height={CHART_H} className="block overflow-visible" aria-hidden="true">
      {yesterdayPath && <path d={yesterdayPath} fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="stroke-topic/25" />}
      {nowIndex > 0 && <path d={pathOf(0, split)} fill="none" strokeWidth={2} strokeLinejoin="round" className="stroke-muted/50" />}
      <path d={pathOf(split, cells.length - 1)} fill="none" strokeWidth={2} strokeLinejoin="round" className="stroke-topic" />
      {points.map((point) =>
        point ? (
          <g key={point.index} className={point.index < nowIndex ? "text-muted/60" : "text-foreground"}>
            <circle cx={point.x} cy={point.y} r={point.index === nowIndex ? 4 : 2.5} className={point.index < nowIndex ? "fill-muted/60" : "fill-topic"} />
            <text x={point.x} y={point.y - 7} textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor">
              {Math.round(point.t)}°
            </text>
          </g>
        ) : null,
      )}
    </svg>
  );
}

/**
 * 1時間ごとの帯（#594・#609）。上から、その時間に居る場所（隣と同じなら1本）・時刻と天気・気温の折れ線・
 * 降水確率（棒と%）・1時間雨量（mm）。`nowIndex` より前は過ぎた時間で、灰色に薄くする（-1は全部が先の時間）。
 * 列は固定幅で、カードの幅に収まらないぶんは帯の中だけ横にスクロールする（ページは横に動かさない）。
 */
export function HourlyStrip({ cells, nowIndex, resetKey }: { cells: HourCell[]; nowIndex: number; resetKey: string }) {
  const bands: { start: number; span: number; cell: HourCell }[] = [];
  cells.forEach((cell, index) => {
    const last = bands.at(-1);
    if (last && last.cell.placeLabel === cell.placeLabel && last.cell.placeKind === cell.placeKind) last.span += 1;
    else bands.push({ start: index, span: 1, cell });
  });
  const total = cells.length;

  return (
    <ScrollToNow className="-mx-0.5 overflow-x-auto overscroll-x-contain px-0.5 pb-1 [scrollbar-width:thin]" resetKey={resetKey}>
      <ol className="relative grid w-max auto-cols-[46px] grid-flow-col gap-y-1" aria-label="1時間ごとの天気">
        {bands.map((band) => (
          <li
            key={`band-${band.start}`}
            aria-hidden="true"
            style={{ gridColumn: `${band.start + 1} / span ${band.span}`, gridRow: 1 }}
            className={cn(
              "mr-0.5 rounded-md px-1.5 py-0.5 text-[0.65625rem] font-bold whitespace-nowrap",
              BAND_CLASS[band.cell.placeKind],
              band.start + band.span <= nowIndex && "opacity-50 grayscale",
            )}
            title={band.cell.placeLabel}
          >
            {/* li に overflow を持たせると sticky の基準が li になり追従しないので、切り詰めはここで行う（#685） */}
            <span className="sticky left-1 inline-block max-w-full truncate align-top">{band.cell.placeLabel}</span>
          </li>
        ))}
        {cells.map((cell, index) => {
          const isNow = index === nowIndex;
          const isPast = index < nowIndex;
          const time = isNow ? "今" : `${cell.hour}時`;
          const known = cell.code !== null || cell.temperature !== null || cell.pop !== null;
          return (
            <li
              key={`${cell.date}-${cell.hour}`}
              data-now={isNow ? "" : undefined}
              style={{ gridColumn: index + 1, gridRow: 2 }}
              className={cn("flex flex-col items-center gap-[3px] rounded-lg pt-1 tabular-nums", isNow && "bg-topic-surface", isPast && "opacity-50 grayscale")}
              aria-label={
                known
                  ? `${cell.hour}時${isPast ? "（過ぎた時間）" : ""} ${cell.placeLabel} ${describeWeatherCode(cell.code)} ${cell.temperature === null ? "—" : Math.round(cell.temperature)}度 降水確率${cell.pop ?? "—"}% 雨量${cell.precipitation === null ? "—" : `${cell.precipitation}ミリ`}`
                  : `${cell.hour}時 ${cell.placeLabel} 予報なし`
              }
            >
              <span className={cn("text-[0.6875rem]", isNow ? "font-bold text-foreground" : "text-muted")}>
                {time}
              </span>
              {known ? <WeatherIcon code={cell.code} className="size-[18px] text-topic" /> : <span className="h-[18px] text-xs text-muted">—</span>}
            </li>
          );
        })}
        <li aria-hidden="true" style={{ gridColumn: `1 / span ${total}`, gridRow: 3 }}>
          <TemperatureChart cells={cells} nowIndex={nowIndex} />
        </li>
        {cells.map((cell, index) => {
          const wet = cell.pop !== null && cell.pop >= RAIN_POP;
          const isPast = index < nowIndex;
          return (
            <li
              key={`pop-${cell.date}-${cell.hour}`}
              aria-hidden="true"
              style={{ gridColumn: index + 1, gridRow: 4 }}
              className={cn(
                "flex flex-col items-center gap-[3px] rounded-lg py-0.5 tabular-nums",
                wet && "bg-topic-surface",
                index === nowIndex && !wet && "bg-topic-surface",
                isPast && "opacity-50 grayscale",
              )}
            >
              <span className="flex h-[30px] w-2 items-end overflow-hidden rounded bg-border">
                <span className="block w-full rounded bg-topic/70" style={{ height: `${cell.pop ?? 0}%` }} />
              </span>
              <span className={cn("text-[0.65625rem]", wet ? "font-bold text-topic" : "text-muted")}>
                {cell.pop === null ? "—" : `${cell.pop}%`}
              </span>
            </li>
          );
        })}
        {cells.map((cell, index) => (
          <li
            key={`mm-${cell.date}-${cell.hour}`}
            aria-hidden="true"
            style={{ gridColumn: index + 1, gridRow: 5 }}
            className={cn(
              "text-center text-[0.65625rem] tabular-nums",
              cell.precipitation !== null && cell.precipitation > 0 ? "font-bold text-topic" : "text-muted",
              index < nowIndex && "opacity-50 grayscale",
            )}
          >
            {cell.precipitation === null ? "—" : cell.precipitation === 0 ? "0" : cell.precipitation.toFixed(1)}
          </li>
        ))}
      </ol>
      <div className="flex gap-3 pt-0.5 text-[0.625rem] text-muted">
        <span>上: 気温（℃）</span>
        <span>中: 降水確率</span>
        <span>下: 雨量（mm/時）</span>
      </div>
    </ScrollToNow>
  );
}
