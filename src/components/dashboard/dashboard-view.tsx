import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  MapPin,
  Sun,
  Umbrella,
} from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { CurrentLocationWeather } from "@/components/dashboard/current-location-weather";
import { LiveNoticeLine, NoticeLiveProvider } from "@/components/dashboard/live-notice-line";
import { dashboardSchedule, dashboardWeather } from "@/lib/dashboard/aide";
import type { ScheduleItem, ScheduleView, WeatherDay, WeatherView } from "@/lib/dashboard/parse";
import { dashboardPlaces, type HourCell, type PlaceSegment, type PlacesView } from "@/lib/dashboard/places";
import type { DashboardNotices, DashboardTopic, DeliveredPush } from "@/lib/dashboard/today";
import { dayLabel, jstDayKey, jstTimeLabel } from "@/lib/day-key";
import { describeWeatherCode, hoursFrom, RAIN_POP, type RainVerdict } from "@/lib/weather/rain-check";
import { cn } from "@/lib/utils";

/**
 * 今日のダッシュボード（#573）。トップ（`/`）に出す。**見るだけの画面で、操作は置かない。**
 *
 * サーバーコンポーネントのまま置く（`/notices`・`/usage` と同じ）。天気・予定はAIDEへ取りに行く
 * ので `Suspense` で後から流し、DBだけで出せるもの（届いた通知・お知らせ・話題）を先に描く。
 *
 * 並びは、スマホ（1列）で上から「天気 → 予定 → 今日届いた通知 → お知らせ → 話題」。PC・iPad
 * （lg以上）は左に天気・お知らせ・話題、右に予定・届いた通知の2列。
 */

type Props = {
  userId: string;
  now: Date;
  heading: string;
  pushes: DeliveredPush[];
  notices: DashboardNotices;
  topics: DashboardTopic[];
};

export function DashboardView({ userId, now, heading, pushes, notices, topics }: Props) {
  // 見出しに地点（市町村名）を出すので、カードごと後から流す。
  const weather = (
    <Suspense
      fallback={
        <Card title="今日の天気">
          <Loading />
        </Card>
      }
    >
      <WeatherCard userId={userId} now={now} />
    </Suspense>
  );
  const schedule = (
    <Card title="今日の予定">
      <Suspense fallback={<Loading />}>
        <ScheduleBody userId={userId} now={now} />
      </Suspense>
    </Card>
  );
  const pushCard = <PushCard pushes={pushes} />;
  const noticeCard = <NoticeCard notices={notices} />;
  const topicCard = <TopicCard topics={topics} />;

  return (
    // お知らせの問い合わせ（選定・仕入れの起点）は1本だけ。2つの並びのどちらからも同じ値を読む。
    <NoticeLiveProvider initial={notices.current}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[980px] flex-col gap-3 px-3.5 py-4 md:gap-4 md:px-7 md:py-6">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 className="text-lg font-bold tracking-wide md:text-[1.375rem]">{heading}</h2>
            <span className="text-xs text-muted">{jstTimeLabel(now)} 時点・天気と予定は開いたときに取得</span>
          </div>

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
    </NoticeLiveProvider>
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

/** 見出しの右の地点（#586）。AIDEが `location` を返すまでは出さない。 */
function PlaceChip({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full border border-border bg-background py-px pr-2 pl-1.5 text-xs font-semibold tracking-normal text-foreground">
      <MapPin className="size-3 text-accent" aria-hidden="true" />
      {name}
      <span className="font-normal text-muted">・自宅</span>
    </span>
  );
}

async function WeatherCard({ userId, now }: { userId: string; now: Date }) {
  const weather: WeatherView = await dashboardWeather(userId, now);
  const homeName = weather.status === "ok" ? (weather.location?.name ?? null) : null;

  return (
    <Card title="今日の天気" aside={homeName && <PlaceChip name={homeName} />}>
      <WeatherBody weather={weather} />
      <Suspense fallback={<p className="text-xs text-muted">時間と場所ごとの天気を取得しています…</p>}>
        <PlacesSection
          userId={userId}
          now={now}
          dailyRainy={weather.status === "ok" && weather.today.pop !== null && weather.today.pop >= RAIN_POP}
          tomorrow={weather.status === "ok" ? weather.tomorrow : null}
          homeName={homeName}
        />
      </Suspense>
      <CurrentLocationWeather />
      <p className="text-[0.625rem] text-muted">
        {weather.status === "ok" && weather.attribution ? weather.attribution : "Weather data by Open-Meteo.com (CC BY 4.0)"}
        ・地名: 国土地理院
      </p>
    </Card>
  );
}

function WeatherBody({ weather }: { weather: WeatherView }) {
  switch (weather.status) {
    case "unconnected":
      return <Unconnected />;
    case "failed":
      return <Failed>天気を取得できませんでした。少し待って再読み込みしてください。</Failed>;
    case "unavailable":
      return (
        <Empty>予報がまだ届いていません（AIDE側で取得できていません）。雨か晴れかは分かりません。</Empty>
      );
    case "ok":
      return <WeatherOk today={weather.today} stale={weather.stale} />;
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
  dailyRainy,
  tomorrow,
  homeName,
}: {
  userId: string;
  now: Date;
  dailyRainy: boolean;
  tomorrow: WeatherDay | null;
  homeName: string | null;
}) {
  const places: PlacesView = await dashboardPlaces(userId, now);
  const tomorrowLine = tomorrow && (
    <div className="text-xs tabular-nums text-muted">
      明日{homeName && `（${homeName}）`} {tomorrow.summary}　{temp(tomorrow.max)} / {temp(tomorrow.min)}
      {tomorrow.pop !== null && `　降水 ${tomorrow.pop}%`}
    </div>
  );
  const fallbackUmbrella = dailyRainy && <UmbrellaNote>傘が要りそうです</UmbrellaNote>;

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

  // 傘の注意は、まだ終わっていない区間だけから選ぶ。行き先を自宅より先に挙げる。
  const nowLabel = jstTimeLabel(now);
  const nowHour = Number(nowLabel.slice(0, 2));
  const rainy = places.today
    .filter((segment) => segment.verdict === "rain" && segment.end > nowLabel)
    .sort((a, b) => Number(a.home) - Number(b.home));
  const later = places.later.filter((day) => day.segments.length > 0);
  const hours = hoursFrom(places.hourly, jstDayKey(now), nowHour);

  return (
    <>
      <div className="flex flex-col gap-1.5 border-t border-border pt-2.5">
        <h4 className="flex justify-between gap-2 text-xs font-bold tracking-[0.06em] text-muted">
          時間と場所ごと <span className="font-normal tracking-normal">今日の予定から</span>
        </h4>
        {places.partial && <Failed>予定の一部を取得できませんでした。行き先が欠けている可能性があります。</Failed>}
        <SegmentList segments={places.today} />
      </div>

      {hours.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-border pt-2.5">
          <h4 className="flex justify-between gap-2 text-xs font-bold tracking-[0.06em] text-muted">
            1時間ごと <span className="font-normal tracking-normal">居る場所の予報</span>
          </h4>
          <HourlyStrip cells={hours} />
          {rainy.length > 0 && <UmbrellaNote>{umbrellaText(rainy[0], rainy.length > 1, nowHour)}</UmbrellaNote>}
          <p className="text-[0.6875rem] text-muted">青い地は降水確率{RAIN_POP}%以上。横にスクロールできます。</p>
        </div>
      )}
      {hours.length === 0 && rainy.length > 0 && (
        <UmbrellaNote>{umbrellaText(rainy[0], rainy.length > 1, nowHour)}</UmbrellaNote>
      )}

      {tomorrowLine}

      {/* 明日以降は押したときだけ開く。JSが動く前でも開けるよう <details> にする。 */}
      <details className="group border-t border-border pt-2.5">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-[0.8125rem] font-semibold hover:bg-rail-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
          明日以降の行き先の雨を見る
          <span className="text-xs text-muted group-open:rotate-180" aria-hidden="true">
            ▾
          </span>
        </summary>
        <div className="mt-2 flex flex-col">
          {later.length === 0 ? (
            <Empty>明日・明後日に場所の分かる予定はありません。</Empty>
          ) : (
            later.map((day) => (
              <div key={day.date} className="flex flex-col">
                <span className="pt-1.5 text-[0.6875rem] font-bold tracking-[0.06em] text-muted">
                  {day.date === places.later[0]?.date ? "明日 " : ""}
                  {dayLabel(day.date)}
                </span>
                <SegmentList segments={day.segments} />
              </div>
            ))
          )}
          <p className="pt-1 text-[0.6875rem] text-muted">
            明後日まで。場所欄が空で移動も無い予定は対象外です。
          </p>
        </div>
      </details>
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

/**
 * 傘の注意（#594）。降り始めの時刻が分かり、まだ来ていなければ「◯◯で14時ごろから雨」。
 * 過ぎている・分からない（自宅を日別予報で代用した区間）ときは従来どおり区間の時間帯で言う。
 */
function umbrellaText(segment: PlaceSegment, more: boolean, nowHour: number): string {
  const weather = segment.weather;
  const others = more ? "ほか" : "";
  if (weather?.rainFrom != null && weather.rainFrom > nowHour) {
    const max = weather.pop !== null ? `（最大${weather.pop}%）` : "";
    return `${placeLabel(segment)}で${weather.rainFrom}時ごろから雨${max}${others}。傘が要りそうです`;
  }
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

/**
 * 1時間ごとの帯（#594）。上段にその時間に居る場所（隣と同じなら1本）、下段に時刻・天気・気温・降水確率。
 * 列は固定幅で、カードの幅に収まらないぶんは帯の中だけ横にスクロールする（ページは横に動かさない）。
 */
function HourlyStrip({ cells }: { cells: HourCell[] }) {
  const bands: { start: number; span: number; cell: HourCell }[] = [];
  cells.forEach((cell, index) => {
    const last = bands.at(-1);
    if (last && last.cell.placeLabel === cell.placeLabel && last.cell.placeKind === cell.placeKind) last.span += 1;
    else bands.push({ start: index, span: 1, cell });
  });

  return (
    <div className="-mx-0.5 overflow-x-auto px-0.5 pb-1 [scrollbar-width:thin]">
      <ol className="grid w-max auto-cols-[46px] grid-flow-col gap-y-1" aria-label="1時間ごとの天気">
        {bands.map((band) => (
          <li
            key={`band-${band.start}`}
            aria-hidden="true"
            style={{ gridColumn: `${band.start + 1} / span ${band.span}`, gridRow: 1 }}
            className={cn(
              "mr-0.5 truncate rounded-md px-1.5 py-0.5 text-[0.65625rem] font-bold whitespace-nowrap",
              BAND_CLASS[band.cell.placeKind],
            )}
            title={band.cell.placeLabel}
          >
            {band.cell.placeLabel}
          </li>
        ))}
        {cells.map((cell, index) => {
          const wet = cell.pop !== null && cell.pop >= RAIN_POP;
          const time = index === 0 ? "今" : cell.date !== cells[0].date && cell.hour === 0 ? "翌0時" : `${cell.hour}時`;
          const known = cell.code !== null || cell.temperature !== null || cell.pop !== null;
          return (
            <li
              key={`${cell.date}-${cell.hour}`}
              style={{ gridColumn: index + 1, gridRow: 2 }}
              className={cn("flex flex-col items-center gap-[3px] rounded-lg pt-1 pb-0.5 tabular-nums", wet && "bg-topic-surface")}
              aria-label={
                known
                  ? `${cell.hour}時 ${cell.placeLabel} ${describeWeatherCode(cell.code)} ${cell.temperature === null ? "—" : Math.round(cell.temperature)}度 降水確率${cell.pop ?? "—"}%`
                  : `${cell.hour}時 ${cell.placeLabel} 予報なし`
              }
            >
              <span className={cn("text-[0.6875rem]", index === 0 ? "font-bold text-foreground" : "text-muted")}>{time}</span>
              {known ? (
                <>
                  <WeatherIcon code={cell.code} className="size-[18px] text-topic" />
                  <span className="text-xs font-semibold">
                    {cell.temperature === null ? "—" : `${Math.round(cell.temperature)}°`}
                  </span>
                  <span className="flex h-[30px] w-2 items-end overflow-hidden rounded bg-border">
                    <span className="block w-full rounded bg-topic/70" style={{ height: `${cell.pop ?? 0}%` }} />
                  </span>
                  <span className={cn("text-[0.65625rem]", wet ? "font-bold text-topic" : "text-muted")}>
                    {cell.pop === null ? "—" : `${cell.pop}%`}
                  </span>
                </>
              ) : (
                <span className="pt-6 text-xs text-muted">—</span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
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

function segmentNote(segment: PlaceSegment): string {
  if (segment.status === "unresolved") return `「${segment.placeText}」の天気は分かりません`;
  if (segment.status === "failed") return "天気を取得できませんでした";
  const weather = segment.weather;
  const parts = [
    segment.label,
    weather?.summary,
    weather && weather.min !== null && weather.max !== null
      ? `${Math.round(weather.min)}〜${Math.round(weather.max)}°`
      : null,
    segment.daily ? "1日の予報" : null,
    weather?.rainFrom != null ? `${weather.rainFrom}時ごろから雨` : null,
  ];
  return parts.filter(Boolean).join("・");
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
              <span className="block text-[0.6875rem] tabular-nums text-muted [overflow-wrap:anywhere]">
                {segmentNote(segment)}
              </span>
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

async function ScheduleBody({ userId, now }: { userId: string; now: Date }) {
  const schedule: ScheduleView = await dashboardSchedule(userId, now);

  switch (schedule.status) {
    case "unconnected":
      return <Unconnected />;
    case "failed":
      return <Failed>予定を取得できませんでした。少し待って再読み込みしてください。</Failed>;
    case "not_configured":
      return <Empty>AIDEで予定（DaySpan）の接続が未設定です。予定が無いという意味ではありません。</Empty>;
    case "ok":
      return <ScheduleOk schedule={schedule} />;
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

function ScheduleOk({ schedule }: { schedule: Extract<ScheduleView, { status: "ok" }> }) {
  const { items, free, partial, googleDisconnected } = schedule;

  return (
    <>
      {partial && <Failed>予定の一部を取得できませんでした。表示が欠けている可能性があります。</Failed>}
      {googleDisconnected && (
        <Failed>Googleカレンダーが未接続のため、カレンダーの予定は出ていません。</Failed>
      )}

      {items.length === 0 ? (
        // 一部が欠けている・未接続の回は「予定なし」と言い切らない。
        !partial && !googleDisconnected && <Empty>今日の予定はありません。</Empty>
      ) : (
        <ul className="grid grid-cols-[84px_minmax(0,1fr)] gap-x-3 md:grid-cols-[92px_minmax(0,1fr)]">
          {items.map((item, index) => {
            const chip = item.kind === "reminder" ? item.note : KIND_CHIP[item.kind];
            const cancelled = item.outcome !== null;
            return (
              <li key={`${item.kind}-${index}`} className="contents">
                <span className="py-1.5 text-[0.8125rem] tabular-nums text-muted">{timeRange(item)}</span>
                <span className="min-w-0 border-b border-border py-1.5 text-sm">
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

function PushCard({ pushes }: { pushes: DeliveredPush[] }) {
  // きのう以前の分は「届いた通知」（`/pushes`。#581）で読む。端末に残った古い通知を開いてもここへ着くため。
  return (
    <Card title="今日届いた通知" link={{ href: "/pushes", label: "これまでの通知" }}>
      {pushes.length === 0 ? <Empty>今日はまだ通知を送っていません。</Empty> : <PushList pushes={pushes} />}
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
