import {
  ArrowDown,
  ArrowDownRight,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
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
import { compareWithYesterday, describeDiff, diffLevel, type DiffLevel } from "@/lib/dashboard/temperature-diff";
import { describeWeatherCode, RAIN_POP } from "@/lib/weather/rain-check";
import { STRIP_COLUMN_W } from "@/lib/weather/strip-layout";
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

/** 昨日との差の一行（#651）。「いま」がある日（今日）だけ出し、昨日の値が無ければ何も出さない。凡例は無い（#1078）。 */
export function YesterdayNote({ cells, nowIndex }: { cells: HourCell[]; nowIndex: number }) {
  if (nowIndex < 0) return null;
  const diff = compareWithYesterday(cells.map((cell, index) => (index === nowIndex ? cell : { ...cell, yesterday: null })), nowIndex);
  if (!diff) return null;
  return <div className="text-xs font-bold text-foreground">{describeDiff(diff, true)}</div>;
}

/** 昨日比の矢印（#1109）。暑い側は暖色、寒い側は寒色、同じくらいは灰色。 */
const DIFF_ARROW: Record<DiffLevel, { Icon: typeof ArrowUp; label: string; className: string }> = {
  "much-warmer": { Icon: ArrowUp, label: "昨日よりかなり暑い", className: "text-accent" },
  warmer: { Icon: ArrowUpRight, label: "昨日よりやや暑い", className: "text-accent" },
  same: { Icon: ArrowRight, label: "昨日と同じくらい", className: "text-muted" },
  colder: { Icon: ArrowDownRight, label: "昨日よりやや寒い", className: "text-topic" },
  "much-colder": { Icon: ArrowDown, label: "昨日よりかなり寒い", className: "text-topic" },
};

/** 数字＋小さい単位（℃・%・mm。#1109）。 */
function Unit({ children }: { children: string }) {
  return <span className="ml-px text-[0.6em] font-normal">{children}</span>;
}

/**
 * 1時間ごとの帯（#594・#609・#1109）。上から、その時間に居る場所（隣と同じなら1本）・時刻と天気・気温（昨日比の矢印つき）・
 * 降水確率（%）・1時間雨量（mm）。グラフは無く数字だけ。`nowIndex` より前は過ぎた時間で、灰色に薄くする（-1は全部が先の時間）。
 * 列は固定幅で、カードの幅に収まらないぶんは帯の中だけ横にスクロールする（ページは横に動かさない）。
 */
export function HourlyStrip({
  cells,
  nowIndex,
  resetKey,
  dateBands,
  focusIndex,
}: {
  cells: HourCell[];
  nowIndex: number;
  resetKey: string;
  /** 日付→最上段のラベル。渡すと最上段は場所ではなく日付ごとに区切る（天気ページ。#869） */
  dateBands?: Record<string, string>;
  /** 開いたとき先頭に出す列（「今」以外の日を指定されたとき）。 */
  focusIndex?: number;
}) {
  const bands: { start: number; span: number; cell: HourCell }[] = [];
  cells.forEach((cell, index) => {
    const last = bands.at(-1);
    const same = dateBands
      ? last?.cell.date === cell.date
      : last?.cell.placeLabel === cell.placeLabel && last?.cell.placeKind === cell.placeKind;
    if (last && same) last.span += 1;
    else bands.push({ start: index, span: 1, cell });
  });
  const todayDate = nowIndex >= 0 ? cells[nowIndex]?.date : undefined;

  return (
    <ScrollToNow className="-mx-0.5 overflow-x-auto overscroll-x-contain px-0.5 pb-1 [scrollbar-width:thin]" resetKey={resetKey}>
      <ol style={{ gridAutoColumns: `${STRIP_COLUMN_W}px` }}
        className="relative grid w-max grid-flow-col gap-y-1" aria-label="1時間ごとの天気">
        {bands.map((band) => (
          <li
            key={`band-${band.start}`}
            aria-hidden="true"
            style={{ gridColumn: `${band.start + 1} / span ${band.span}`, gridRow: 1 }}
            className={cn(
              "mr-0.5 rounded-md px-1.5 py-0.5 text-[0.65625rem] font-bold whitespace-nowrap",
              dateBands ? (band.cell.date === todayDate ? BAND_CLASS.away : BAND_CLASS.home) : BAND_CLASS[band.cell.placeKind],
              band.start + band.span <= nowIndex && "opacity-50 grayscale",
            )}
            title={dateBands ? (dateBands[band.cell.date] ?? band.cell.date) : band.cell.placeLabel}
          >
            {/* li に overflow を持たせると sticky の基準が li になり追従しないので、切り詰めはここで行う（#685） */}
            <span className="sticky left-1 inline-block max-w-full truncate align-top">{dateBands ? (dateBands[band.cell.date] ?? band.cell.date) : band.cell.placeLabel}</span>
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
              data-focus={index === focusIndex ? "" : undefined}
              data-hour=""
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
        {cells.map((cell, index) => {
          const level = cell.temperature !== null && cell.yesterday !== null ? diffLevel(cell.temperature - cell.yesterday) : null;
          const arrow = level ? DIFF_ARROW[level] : null;
          return (
            <li
              key={`temp-${cell.date}-${cell.hour}`}
              aria-hidden="true"
              style={{ gridColumn: index + 1, gridRow: 3 }}
              className={cn(
                "flex flex-col items-center gap-px text-center text-xs font-bold tabular-nums",
                index === nowIndex && "bg-topic-surface",
                index < nowIndex && "opacity-50 grayscale",
              )}
            >
              <span className="whitespace-nowrap">
                {cell.temperature === null ? "—" : <>{Math.round(cell.temperature)}<Unit>℃</Unit></>}
              </span>
              {arrow ? <arrow.Icon className={cn("size-3", arrow.className)} aria-label={arrow.label} /> : <span className="h-3" />}
            </li>
          );
        })}
        {cells.map((cell, index) => {
          const wet = cell.pop !== null && cell.pop >= RAIN_POP;
          return (
            <li
              key={`pop-${cell.date}-${cell.hour}`}
              aria-hidden="true"
              style={{ gridColumn: index + 1, gridRow: 4 }}
              className={cn(
                "rounded-lg py-0.5 text-center text-[0.65625rem] tabular-nums",
                wet ? "bg-topic-surface font-bold text-topic" : "text-muted",
                index === nowIndex && !wet && "bg-topic-surface",
                index < nowIndex && "opacity-50 grayscale",
              )}
            >
              {cell.pop === null ? "—" : <>{cell.pop}<Unit>%</Unit></>}
            </li>
          );
        })}
        {cells.map((cell, index) => (
          <li
            key={`mm-${cell.date}-${cell.hour}`}
            aria-hidden="true"
            style={{ gridColumn: index + 1, gridRow: 5 }}
            className={cn(
              "whitespace-nowrap text-center text-[0.65625rem] tabular-nums",
              cell.precipitation !== null && cell.precipitation > 0 ? "font-bold text-topic" : "text-muted",
              index < nowIndex && "opacity-50 grayscale",
            )}
          >
            {cell.precipitation === null ? "—" : <>{cell.precipitation === 0 ? "0" : cell.precipitation.toFixed(1)}<Unit>mm</Unit></>}
          </li>
        ))}
      </ol>
    </ScrollToNow>
  );
}
