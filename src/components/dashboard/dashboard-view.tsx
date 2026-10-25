import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Sun,
  Umbrella,
} from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { CurrentLocationWeather } from "@/components/dashboard/current-location-weather";
import { DaySwipe } from "@/components/dashboard/day-swipe";
import { ScrollToNow } from "@/components/dashboard/scroll-to-now";
import { LiveNoticeLine, NoticeLiveProvider } from "@/components/dashboard/live-notice-line";
import { dashboardSchedule } from "@/lib/dashboard/aide";
import { addDays, cardDayName, DAY_RANGE, dayHref, relativeDayName } from "@/lib/dashboard/day-offset";
import type { ScheduleItem, ScheduleView, WeatherDay } from "@/lib/dashboard/parse";
import { schedulePhase, type SchedulePhase } from "@/lib/dashboard/schedule-phase";
import {
  dashboardDayWeather,
  dashboardPlaces,
  type DayWeatherView,
  type HourCell,
  type PlaceSegment,
  type PlacesView,
} from "@/lib/dashboard/places";
import type { DashboardNotices, DashboardTopic, DeliveredPush } from "@/lib/dashboard/today";
import { dayLabel, jstDayKey, jstTimeLabel } from "@/lib/day-key";
import { describeWeatherCode, RAIN_POP, type RainVerdict } from "@/lib/weather/rain-check";
import { cn } from "@/lib/utils";

/**
 * 今日のダッシュボード（#573）。トップ（`/`）に出す。**見るだけの画面で、操作は置かない。**
 *
 * サーバーコンポーネントのまま置く（`/notices`・`/usage` と同じ）。天気・予定はAIDEへ取りに行く
 * ので `Suspense` で後から流し、DBだけで出せるもの（届いた通知・お知らせ・話題）を先に描く。
 *
 * 並びは、スマホ（1列）で上から「天気 → 予定 → 今日届いた通知 → お知らせ → 話題」。PC・iPad
 * （lg以上）は左に天気・お知らせ・話題、右に予定・届いた通知の2列。
 *
 * 左右のスワイプ（`DaySwipe`）・見出しの ‹ › で前後の日へめくる（#606。`?d=`）。今日以外の日は、天気・予定・
 * その日届いた通知（未来の日は出さない）だけを出す。お知らせ・話題・現在地の天気は「いま」の
 * 状態なので今日だけ。お知らせの問い合わせ（`NoticeLiveProvider`）はどの日でも外さない（仕入れの起点）。
 */

type Props = {
  userId: string;
  now: Date;
  todayKey: string;
  /** 表示する日の今日からのずれ（0＝今日）。 */
  offset: number;
  pushes: DeliveredPush[];
  notices: DashboardNotices;
  topics: DashboardTopic[];
};

export function DashboardView({ userId, now, todayKey, offset, pushes, notices, topics }: Props) {
  const dayKey = addDays(todayKey, offset);
  const dayName = cardDayName(dayKey, offset);
  const isToday = offset === 0;

  // 見出しに地点（市町村名）を出すので、カードごと後から流す。`key` を日付にして、めくった直後は
  // 前の日の中身を残さず「取得しています…」を出す（新しい境界として扱わせる）。
  const weather = (
    <Suspense
      key={`weather-${dayKey}`}
      fallback={
        <Card title={`${dayName}の天気`}>
          <Loading />
        </Card>
      }
    >
      <WeatherCard userId={userId} now={now} offset={offset} dayKey={dayKey} />
    </Suspense>
  );
  const schedule = (
    <Card title={`${dayName}の予定・記録`}>
      <Suspense key={`schedule-${dayKey}`} fallback={<Loading />}>
        <ScheduleBody userId={userId} now={now} offset={offset} />
      </Suspense>
    </Card>
  );
  // 未来の日はまだ何も届いていないので出さない。
  const pushCard = offset <= 0 && <PushCard pushes={pushes} day={dayName} isToday={isToday} />;
  const noticeCard = isToday && <NoticeCard notices={notices} />;
  const topicCard = isToday && <TopicCard topics={topics} />;

  const prev = offset > -DAY_RANGE ? offset - 1 : null;
  const next = offset < DAY_RANGE ? offset + 1 : null;
  const peekName = (target: number) => relativeDayName(target) ?? cardDayName(addDays(todayKey, target), target);

  return (
    // お知らせの問い合わせ（選定・仕入れの起点）は1本だけ。2つの並びのどちらからも同じ値を読む。
    <NoticeLiveProvider initial={notices.current}>
      <DaySwipe
        prevHref={prev === null ? null : dayHref(todayKey, prev)}
        nextHref={next === null ? null : dayHref(todayKey, next)}
        prevLabel={prev === null ? null : peekName(prev)}
        nextLabel={next === null ? null : peekName(next)}
      >
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-[980px] flex-col gap-3 px-3.5 py-4 md:gap-4 md:px-7 md:py-6">
            <DayNav todayKey={todayKey} offset={offset} prev={prev} next={next} now={now} />

            {/* スマホ: 1列（読む順） */}
            <div className="flex flex-col gap-3 lg:hidden">
              {weather}
              {schedule}
              {pushCard}
              {noticeCard}
              {topicCard}
            </div>

            {/* PC・iPad横向き: 2列。どちらの並びもHTMLに入り、CSSで片方を隠す（取得の重複は `DesktopOnly` の注記） */}
            <DesktopOnly>
              <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-start gap-3.5">
                <div className="flex min-w-0 flex-col gap-3.5">
                  {weather}
                  {noticeCard}
                  {topicCard}
                </div>
                <div className="flex min-w-0 flex-col gap-3.5">
                  {schedule}
                  {pushCard}
                </div>
              </div>
            </DesktopOnly>
          </div>
        </div>
      </DaySwipe>
    </NoticeLiveProvider>
  );
}

const NAV_BUTTON =
  "grid size-8 shrink-0 place-items-center rounded-full border border-border bg-surface text-base font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/**
 * 見出しの日付と前後への移動（#606）。ボタンは `Link`（`replace`）なので、JSが動く前でも押せる。
 * 端の日では押せない形（薄い・リンクでない）にする。ドットは範囲（前後 `DAY_RANGE` 日）の中の位置。
 */
function DayNav({
  todayKey,
  offset,
  prev,
  next,
  now,
}: {
  todayKey: string;
  offset: number;
  prev: number | null;
  next: number | null;
  now: Date;
}) {
  const dayKey = addDays(todayKey, offset);
  const relative = relativeDayName(offset);
  const step = (target: number | null, label: string, glyph: string) =>
    target === null ? (
      <span className={cn(NAV_BUTTON, "text-muted opacity-40")} aria-hidden="true">
        {glyph}
      </span>
    ) : (
      <Link href={dayHref(todayKey, target)} replace scroll={false} aria-label={label} className={cn(NAV_BUTTON, "hover:bg-rail-active")}>
        {glyph}
      </Link>
    );

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1.5">
        {step(prev, "前の日", "‹")}
        <h2 className="flex items-baseline gap-2 text-lg font-bold tracking-wide md:text-[1.375rem]">
          {dayLabel(dayKey)}
          {relative && (
            <span
              className={cn(
                "rounded-full px-2 py-px text-xs font-bold tracking-normal",
                offset === 0 ? "bg-accent-surface text-accent" : "bg-topic-surface text-topic",
              )}
            >
              {relative}
            </span>
          )}
        </h2>
        {step(next, "次の日", "›")}
      </div>
      {/* データを取得した時刻。日付の中心を保つため、ドットと「今日へ」はこの行に置く */}
      <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-xs text-muted">
        <span>{jstTimeLabel(now)} 時点</span>
        <span className="hidden items-center gap-1 sm:flex" aria-hidden="true">
          {Array.from({ length: DAY_RANGE * 2 + 1 }, (_, index) => index - DAY_RANGE).map((dot) => (
            <i
              key={dot}
              className={cn(
                "block h-[5px] rounded-full",
                dot === offset ? "w-3.5 bg-accent" : dot === 0 ? "w-[5px] bg-muted" : "w-[5px] bg-border",
              )}
            />
          ))}
        </span>
        {offset !== 0 && (
          <Link
            href="/"
            replace
            scroll={false}
            className="rounded-full border border-accent px-3 py-0.5 text-xs font-bold text-accent hover:bg-accent-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            今日へ
          </Link>
        )}
      </div>
    </div>
  );
}

/**
 * lg以上だけで見せる枠。**中身はサーバーで描いて同じHTMLに入る**ため、天気・予定の取得は
 * 上の1列ぶんと合わせて2回呼ばれるが、`dashboardWeather()` が走っている取得を共有するので
 * AIDEへは1本しか出ない。
 */
function DesktopOnly({ children }: { children: React.ReactNode }) {
  return <div className="hidden lg:block">{children}</div>;
}

function Card({
  title,
  link,
  aside,
  children,
}: {
  title: string;
  link?: { href: string; label: string };
  /** 見出しの右に置く補足（天気の地点など）。 */
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2.5 rounded-xl border border-border bg-surface px-4 py-3.5 md:rounded-2xl md:px-[18px] md:py-4">
      <h3 className="flex items-center justify-between gap-2 text-xs font-bold tracking-[0.1em] text-muted">
        {title}
        {aside}
        {link && (
          <Link
            href={link.href}
            className="text-xs font-semibold tracking-normal text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {link.label} →
          </Link>
        )}
      </h3>
      {children}
    </section>
  );
}

function Loading() {
  return <p className="text-xs text-muted">取得しています…</p>;
}

/** 取れなかった（赤）。「無い」（点線）とは見た目を分ける（#214）。 */
function Failed({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="rounded-[10px] bg-danger-surface px-3 py-2.5 text-[0.8125rem] leading-relaxed text-danger">
      {children}
    </p>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-[10px] border border-dashed border-border bg-background px-3 py-2.5 text-[0.8125rem] leading-relaxed text-muted">
      {children}
    </p>
  );
}

function Unconnected() {
  return (
    <Empty>
      AIDEが未接続です。
      <Link href="/settings" className="text-accent underline-offset-2 hover:underline">
        設定の接続
      </Link>
      から追加すると、天気と予定が出ます。
    </Empty>
  );
}

/* ---------------- 天気 ---------------- */

async function WeatherCard({
  userId,
  now,
  offset,
  dayKey,
}: {
  userId: string;
  now: Date;
  offset: number;
  dayKey: string;
}) {
  const [weather, tomorrow] = await Promise.all([
    dashboardDayWeather(userId, now, dayKey),
    // 今日の画面だけ、明日の1行を添える（めくった先の日では出さない）。
    offset === 0 ? dashboardDayWeather(userId, now, addDays(dayKey, 1)) : null,
  ]);
  const homeName = weather.status === "ok" ? (weather.location?.name ?? null) : null;

  return (
    <Card title={`${cardDayName(dayKey, offset)}の天気`} aside={offset === 0 && <CurrentLocationWeather />}>
      <WeatherBody weather={weather} />
      <Suspense fallback={<p className="text-xs text-muted">時間と場所ごとの天気を取得しています…</p>}>
        <PlacesSection
          userId={userId}
          now={now}
          offset={offset}
          dayKey={dayKey}
          dailyRainy={weather.status === "ok" && weather.day.pop !== null && weather.day.pop >= RAIN_POP}
          tomorrow={tomorrow?.status === "ok" ? tomorrow.day : null}
          homeName={homeName}
        />
      </Suspense>
      <p className="text-[0.625rem] text-muted">
        {weather.status === "ok" && weather.attribution ? weather.attribution : "Weather data by Open-Meteo.com (CC BY 4.0)"}
        ・地名: 国土地理院
      </p>
    </Card>
  );
}

function WeatherBody({ weather }: { weather: DayWeatherView }) {
  switch (weather.status) {
    case "unconnected":
      return <Unconnected />;
    case "failed":
      return <Failed>天気を取得できませんでした。少し待って再読み込みしてください。</Failed>;
    case "unavailable":
      return (
        <Empty>予報がまだ届いていません（AIDE側で取得できていません）。雨か晴れかは分かりません。</Empty>
      );
    case "none":
      // 今日・明日以外はAIDEの予報が無く、自宅の地点（AIDEの `location`）が届くまでは引けない（#606）。
      return <Empty>この日の予報はありません（自宅の地点がまだAIDEから届いていません）。</Empty>;
    case "ok":
      return <WeatherOk today={weather.day} stale={weather.stale} />;
  }
}

function temp(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}°`;
}

function WeatherOk({ today, stale }: { today: WeatherDay; stale: boolean }) {
  const rainy = today.pop !== null && today.pop >= RAIN_POP;
  const Icon = rainy ? CloudRain : CloudSun;

  return (
    <>
      <div className="flex items-center gap-3.5">
        <div className="grid size-12 shrink-0 place-items-center rounded-[14px] bg-topic-surface text-topic">
          <Icon className="size-6" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <div className="text-lg font-bold">
            {today.summary}
            {today.pop !== null && (
              <span className="text-xs font-normal tabular-nums text-muted">　降水 {today.pop}%</span>
            )}
          </div>
          <div className="text-[0.8125rem] tabular-nums">
            最高 <span className="font-bold text-accent">{temp(today.max)}</span> ／ 最低{" "}
            <span className="font-bold text-topic">{temp(today.min)}</span>
          </div>
        </div>
      </div>

      {stale && <p className="text-xs text-muted">AIDE側の更新が止まっているため、古い予報の可能性があります。</p>}
    </>
  );
}

/* ---- 時間と場所ごと（#586） ---- */

async function PlacesSection({
  userId,
  now,
  offset,
  dayKey,
  dailyRainy,
  tomorrow,
  homeName,
}: {
  userId: string;
  now: Date;
  offset: number;
  dayKey: string;
  dailyRainy: boolean;
  tomorrow: WeatherDay | null;
  homeName: string | null;
}) {
  const places: PlacesView = await dashboardPlaces(userId, now, offset);
  const tomorrowLine = tomorrow && (
    <div className="text-xs tabular-nums text-muted">
      明日{homeName && `（${homeName}）`} {tomorrow.summary}　{temp(tomorrow.max)} / {temp(tomorrow.min)}
      {tomorrow.pop !== null && `　降水 ${tomorrow.pop}%`}
    </div>
  );
  // 過ぎた日に傘の注意は要らない。
  const fallbackUmbrella = dailyRainy && offset >= 0 && <UmbrellaNote>傘が要りそうです</UmbrellaNote>;

  if (places.status !== "ok") {
    // 未接続・未設定は天気の側（AIDE）で案内が出るので、ここでは重ねない。
    return (
      <>
        {fallbackUmbrella}
        {places.status === "failed" && <Failed>時間と場所ごとの天気を取得できませんでした。</Failed>}
        {tomorrowLine}
      </>
    );
  }

  // 傘の注意は、まだ終わっていない区間だけから選ぶ（先の日は全部、過ぎた日は無し）。行き先を自宅より先に挙げる。
  // 今日以外の日は、帯をその日の0〜23時のまま出す（`nowHour` を -1 にする）。
  const nowLabel = offset === 0 ? jstTimeLabel(now) : offset > 0 ? "00:00" : "24:00";
  const nowHour = offset === 0 ? Number(nowLabel.slice(0, 2)) : -1;
  const rainy = places.today
    .filter((segment) => segment.verdict === "rain" && segment.end > nowLabel)
    .sort((a, b) => Number(a.home) - Number(b.home));
  // 帯は表示する日の0〜23時だけ（#620。取得の側で1日ぶんに絞ってある）。今日は過ぎた時間が灰色（#609）。
  const hours = places.hourly;
  const nowIndex = offset === 0 ? hours.findIndex((cell) => cell.date === jstDayKey(now) && cell.hour === nowHour) : -1;
  const dayName = cardDayName(dayKey, offset);

  return (
    <>
      <div className="flex flex-col gap-1.5 border-t border-border pt-2.5">
        <h4 className="flex justify-between gap-2 text-xs font-bold tracking-[0.06em] text-muted">
          時間と場所ごと <span className="font-normal tracking-normal">{dayName}の予定から</span>
        </h4>
        {places.partial && <Failed>予定の一部を取得できませんでした。行き先が欠けている可能性があります。</Failed>}
        <SegmentList segments={places.today} />
      </div>

      {hours.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-border pt-2.5">
          <h4 className="flex justify-between gap-2 text-xs font-bold tracking-[0.06em] text-muted">
            1時間ごと{" "}
            <span className="font-normal tracking-normal">
              居る場所の予報・0〜23時
            </span>
          </h4>
          <HourlyStrip cells={hours} nowIndex={nowIndex} resetKey={`${dayKey}:${offset}`} />
          {rainy.length > 0 && <UmbrellaNote>{umbrellaText(rainy[0], rainy.length > 1)}</UmbrellaNote>}
          <p className="text-[0.6875rem] text-muted">青い地は降水確率{RAIN_POP}%以上。灰色は過ぎた時間。横にスクロールできます。端でさらに引くと前後の日へ移ります。</p>
        </div>
      )}
      {hours.length === 0 && rainy.length > 0 && (
        <UmbrellaNote>{umbrellaText(rainy[0], rainy.length > 1)}</UmbrellaNote>
      )}

      {tomorrowLine}
    </>
  );
}

function UmbrellaNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg bg-topic-surface px-2.5 py-1.5 text-xs font-semibold text-topic">
      <Umbrella className="size-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

/** 傘の注意。降り始めの時刻は言わず、区間の時間帯で言う（#608。区間は雨が続く前提で、「◯時ごろから」は誤読を招く）。 */
function umbrellaText(segment: PlaceSegment, more: boolean): string {
  const others = more ? "ほか" : "";
  return `${placeLabel(segment)}（${segmentTime(segment)}）${others}は傘が要りそうです`;
}

/** 天気コード（WMO）→ アイコン。表の区切りは `describeWeatherCode()` と同じ。 */
function WeatherIcon({ code, className }: { code: number | null; className?: string }) {
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

const CELL_W = 46;
const CHART_H = 64;
const CHART_PAD_TOP = 18;
const CHART_PAD_BOTTOM = 8;

/** 気温の折れ線（#609）。全列にまたがる1枚のSVGで、各点の上に値を出す。過ぎた時間（`nowIndex` より前）は灰色。 */
function TemperatureChart({ cells, nowIndex }: { cells: HourCell[]; nowIndex: number }) {
  const temps = cells.flatMap((cell) => (cell.temperature === null ? [] : [cell.temperature]));
  if (temps.length === 0) return null;
  const min = Math.min(...temps);
  const max = Math.max(...temps);
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
  const split = nowIndex >= 0 ? nowIndex : 0;
  return (
    <svg width={cells.length * CELL_W} height={CHART_H} className="block overflow-visible" aria-hidden="true">
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
function HourlyStrip({ cells, nowIndex, resetKey }: { cells: HourCell[]; nowIndex: number; resetKey: string }) {
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
              "mr-0.5 truncate rounded-md px-1.5 py-0.5 text-[0.65625rem] font-bold whitespace-nowrap",
              BAND_CLASS[band.cell.placeKind],
              band.start + band.span <= nowIndex && "opacity-50 grayscale",
            )}
            title={band.cell.placeLabel}
          >
            {band.cell.placeLabel}
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

function segmentTime(segment: PlaceSegment): string {
  if (segment.allDay) return "終日";
  if (segment.start === "00:00" && segment.end === "24:00") return "終日";
  if (segment.start === "00:00") return `〜${segment.end}`;
  if (segment.end === "24:00") return `${segment.start}〜`;
  return `${segment.start}–${segment.end}`;
}

function placeLabel(segment: PlaceSegment): string {
  if (segment.home) return segment.placeName ?? "自宅";
  return segment.placeName ?? "場所不明";
}

const VERDICT_PILL: Record<RainVerdict, { label: string; className: string }> = {
  rain: { label: "雨", className: "bg-topic-surface text-topic" },
  maybe: { label: "降るかも", className: "bg-accent-surface text-accent" },
  dry: { label: "降らない見込み", className: "bg-fair-surface text-fair" },
  unknown: { label: "—", className: "bg-background text-muted" },
};

function segmentNote(segment: PlaceSegment): React.ReactNode {
  if (segment.status === "unresolved") return `「${segment.placeText}」の天気は分かりません`;
  if (segment.status === "failed") return "天気を取得できませんでした";
  const weather = segment.weather;
  if (!weather) return null;
  return (
    <span className="flex items-center gap-1.5">
      <WeatherIcon code={weather.code} className="size-3.5 text-topic" />
      <span>{weather.summary}</span>
      {segment.daily && <span>・1日の予報</span>}
    </span>
  );
}

function SegmentList({ segments }: { segments: PlaceSegment[] }) {
  return (
    <ul className="flex flex-col">
      {segments.map((segment) => {
        const pill = VERDICT_PILL[segment.status === "ok" ? segment.verdict : "unknown"];
        const pop = segment.status === "ok" ? segment.weather?.pop : null;
        return (
          <li
            key={`${segment.date}-${segment.start}-${segment.placeText}`}
            className="grid grid-cols-[78px_minmax(0,1fr)_auto] items-center gap-x-2.5 border-b border-border py-1.5 text-[0.8125rem] last:border-b-0 md:grid-cols-[84px_minmax(0,1fr)_auto]"
          >
            <span className="text-xs tabular-nums text-muted">{segmentTime(segment)}</span>
            <span className="min-w-0">
              <b className="font-bold">
                <span
                  className={cn("mr-1.5 inline-block size-1.5 rounded-full align-middle", segment.home ? "bg-muted" : "bg-accent")}
                  aria-hidden="true"
                />
                {placeLabel(segment)}
                {segment.home && segment.placeName && <span className="font-normal text-muted">・自宅</span>}
              </b>
              <span className="block text-xs text-muted [overflow-wrap:anywhere]">{segmentNote(segment)}</span>
            </span>
            <span className={cn("rounded-full px-2 py-0.5 text-[0.6875rem] font-bold whitespace-nowrap tabular-nums", pill.className)}>
              {pill.label}
              {pop !== null && pop !== undefined && ` ${pop}%`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------- 予定 ---------------- */

async function ScheduleBody({ userId, now, offset }: { userId: string; now: Date; offset: number }) {
  const schedule: ScheduleView = await dashboardSchedule(userId, now, offset);

  switch (schedule.status) {
    case "unconnected":
      return <Unconnected />;
    case "failed":
      return <Failed>予定を取得できませんでした。少し待って再読み込みしてください。</Failed>;
    case "not_configured":
      return <Empty>AIDEで予定（DaySpan）の接続が未設定です。予定が無いという意味ではありません。</Empty>;
    case "ok":
      return <ScheduleOk schedule={schedule} now={now} offset={offset} />;
  }
}

const KIND_CHIP: Record<ScheduleItem["kind"], string | null> = {
  event: null,
  travel: "移動",
  reminder: null,
  task: "タスク",
};

function timeRange(item: ScheduleItem): string {
  if (!item.start) return item.kind === "event" ? "終日" : "—";
  return item.end ? `${item.start}–${item.end}` : item.start;
}

/** 終わった予定は少し、記録は大きく薄くする（#626）。これからの予定は従来の色のまま。 */
const PHASE_FADE: Record<SchedulePhase, string | null> = {
  upcoming: null,
  done: "opacity-75",
  record: "opacity-50",
};

const PHASE_LEGEND: { phase: SchedulePhase; label: string }[] = [
  { phase: "upcoming", label: "これから" },
  { phase: "done", label: "終わった予定" },
  { phase: "record", label: "記録" },
];

function ScheduleOk({ schedule, now, offset }: { schedule: Extract<ScheduleView, { status: "ok" }>; now: Date; offset: number }) {
  const { items, free, partial, googleDisconnected } = schedule;
  const nowTime = jstTimeLabel(now);
  const phases = items.map((item) => schedulePhase(item, nowTime, offset));
  // 薄い行が無い日は凡例を出さない（全部これからなら、区別するものが無い）。
  const legend = phases.some((phase) => phase !== "upcoming") ? PHASE_LEGEND.filter((entry) => phases.includes(entry.phase)) : [];

  return (
    <>
      {partial && <Failed>予定の一部を取得できませんでした。表示が欠けている可能性があります。</Failed>}
      {googleDisconnected && (
        <Failed>Googleカレンダーが未接続のため、カレンダーの予定は出ていません。</Failed>
      )}

      {items.length === 0 ? (
        // 一部が欠けている・未接続の回は「予定なし」と言い切らない。
        !partial && !googleDisconnected && <Empty>この日の予定はありません。</Empty>
      ) : (
        <>
        {legend.length > 0 && (
          <p className="flex flex-wrap gap-x-3.5 text-[0.6875rem] text-muted">
            {legend.map((entry) => (
              <span key={entry.phase}>
                <span
                  className={cn("mr-1.5 inline-block size-2 rounded-full bg-foreground align-baseline", PHASE_FADE[entry.phase])}
                  aria-hidden="true"
                />
                {entry.label}
              </span>
            ))}
          </p>
        )}
        <ul className="grid grid-cols-[84px_minmax(0,1fr)] gap-x-3 md:grid-cols-[92px_minmax(0,1fr)]">
          {items.map((item, index) => {
            const fade = PHASE_FADE[phases[index]];
            const chip = item.kind === "reminder" ? item.note : KIND_CHIP[item.kind];
            const cancelled = item.outcome !== null;
            return (
              <li key={`${item.kind}-${index}`} className="contents">
                <span className={cn("py-1.5 text-[0.8125rem] tabular-nums text-muted", fade)}>{timeRange(item)}</span>
                <span className={cn("min-w-0 border-b border-border py-1.5 text-sm", fade)}>
                  {chip && (
                    <span
                      className={cn(
                        "mr-1.5 inline-block rounded-full px-[7px] py-px text-[0.6875rem]",
                        item.kind === "reminder" ? "bg-accent-surface text-accent" : "bg-topic-surface text-topic",
                      )}
                    >
                      {chip}
                    </span>
                  )}
                  {item.url ? (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn("hover:underline", cancelled && "text-muted line-through")}
                    >
                      {item.title}
                    </a>
                  ) : (
                    <span className={cn(cancelled && "text-muted line-through")}>{item.title}</span>
                  )}
                  {cancelled && (
                    <span className="ml-1.5 text-[0.6875rem] text-muted">
                      {item.outcome === "CANCELED" ? "中止" : "不参加"}
                    </span>
                  )}
                  {item.kind === "event" && item.note && (
                    <span className="ml-1.5 text-[0.6875rem] text-muted">{item.note}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        </>
      )}

      {free.length > 0 && (
        <p className="text-xs text-muted">
          空き時間{" "}
          {free.map((slot, index) => (
            <span key={slot.from}>
              {index > 0 && "・"}
              <b className="font-semibold tabular-nums text-foreground">
                {slot.from}–{slot.to}
              </b>
            </span>
          ))}
        </p>
      )}
    </>
  );
}

/* ---------------- 今日届いた通知 ---------------- */

function PushCard({ pushes, day, isToday }: { pushes: DeliveredPush[]; day: string; isToday: boolean }) {
  // きのう以前の分は「届いた通知」（`/pushes`。#581）で読む。端末に残った古い通知を開いてもここへ着くため。
  // 前の日へめくったときは、その日の分をここに出す（#606）。
  return (
    <Card title={`${day}${/\d日$/.test(day) ? "に" : ""}届いた通知`} link={{ href: "/pushes", label: "これまでの通知" }}>
      {pushes.length === 0 ? (
        <Empty>{isToday ? "今日はまだ通知を送っていません。" : "この日は通知を送っていません。"}</Empty>
      ) : (
        <PushList pushes={pushes} />
      )}
    </Card>
  );
}

/** 届いた通知の本文の並び。ダッシュボードと「届いた通知」（`/pushes`）で共有する。 */
export function PushList({ pushes }: { pushes: DeliveredPush[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {pushes.map((push) => (
        <li
          key={push.id}
          className={cn("flex flex-col gap-1 border-l-[3px] py-0.5 pl-3", push.urgent ? "border-danger" : "border-accent")}
        >
          <div className="flex gap-2 text-[0.6875rem] text-muted">
            <b className={push.urgent ? "text-danger" : "text-accent"}>{push.label}</b>
            <span className="tabular-nums">{jstTimeLabel(push.createdAt)}</span>
            {push.urgent && push.title !== push.label && <span className="min-w-0 truncate">{push.title}</span>}
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{push.body}</p>
        </li>
      ))}
    </ul>
  );
}

/* ---------------- お知らせ・話題 ---------------- */

function NoticeCard({ notices }: { notices: DashboardNotices }) {
  return (
    <Card title="お知らせ" link={{ href: "/notices", label: "一覧へ" }}>
      <LiveNoticeLine />
      <p className="text-xs text-muted">
        まだ出していない <b className="font-semibold tabular-nums text-foreground">{notices.pendingCount}件</b>
        {notices.urgentCount > 0 && `（うち急ぎ ${notices.urgentCount}件）`}
      </p>
    </Card>
  );
}

function TopicCard({ topics }: { topics: DashboardTopic[] }) {
  return (
    <Card title="話題" link={{ href: "/topics", label: "一覧へ" }}>
      {topics.length === 0 ? (
        <Empty>いま溜まっている話題はありません。</Empty>
      ) : (
        <ul className="flex flex-col">
          {topics.map((topic) => (
            <li key={topic.id} className="flex flex-col gap-0.5 border-b border-border py-2 last:border-b-0">
              <span className="text-sm font-semibold leading-normal">
                <span className="mr-1.5 inline-block rounded-full bg-topic-surface px-[7px] py-px text-[0.6875rem] font-normal text-topic">
                  {topic.chip}
                </span>
                {topic.url ? (
                  <a href={topic.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {topic.title}
                  </a>
                ) : (
                  topic.title
                )}
              </span>
              <span className="text-xs leading-relaxed text-muted">{topic.lead}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
