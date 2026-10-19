import { CloudRain, CloudSun, Umbrella } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { LiveNoticeLine, NoticeLiveProvider } from "@/components/dashboard/live-notice-line";
import { dashboardSchedule, dashboardWeather } from "@/lib/dashboard/aide";
import type { ScheduleItem, ScheduleView, WeatherDay, WeatherView } from "@/lib/dashboard/parse";
import type { DashboardNotices, DashboardTopic, DeliveredPush } from "@/lib/dashboard/today";
import { jstTimeLabel } from "@/lib/day-key";
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

const RAIN_POP = 50;

export function DashboardView({ userId, now, heading, pushes, notices, topics }: Props) {
  const weather = (
    <Card title="今日の天気">
      <Suspense fallback={<Loading />}>
        <WeatherBody userId={userId} now={now} />
      </Suspense>
    </Card>
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
  children,
}: {
  title: string;
  link?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2.5 rounded-xl border border-border bg-surface px-4 py-3.5 md:rounded-2xl md:px-[18px] md:py-4">
      <h3 className="flex items-center justify-between gap-2 text-xs font-bold tracking-[0.1em] text-muted">
        {title}
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

async function WeatherBody({ userId, now }: { userId: string; now: Date }) {
  const weather: WeatherView = await dashboardWeather(userId, now);

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
      return <WeatherOk today={weather.today} tomorrow={weather.tomorrow} stale={weather.stale} attribution={weather.attribution} />;
  }
}

function temp(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}°`;
}

function WeatherOk({
  today,
  tomorrow,
  stale,
  attribution,
}: {
  today: WeatherDay;
  tomorrow: WeatherDay | null;
  stale: boolean;
  attribution: string | null;
}) {
  const rainy = today.pop !== null && today.pop >= RAIN_POP;
  const Icon = rainy ? CloudRain : CloudSun;

  return (
    <>
      <div className="flex items-center gap-3.5">
        <div className="grid size-14 shrink-0 place-items-center rounded-[14px] bg-topic-surface text-topic">
          <Icon className="size-7" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <div className="text-xl font-bold">{today.summary}</div>
          <div className="text-sm tabular-nums">
            最高 <span className="font-bold text-accent">{temp(today.max)}</span> ／ 最低{" "}
            <span className="font-bold text-topic">{temp(today.min)}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        <span className="text-xs text-muted">降水確率</span>
        <span className="h-2 flex-1 overflow-hidden rounded bg-border" aria-hidden="true">
          <span className="block h-full bg-topic" style={{ width: `${Math.min(100, Math.max(0, today.pop ?? 0))}%` }} />
        </span>
        <span className="min-w-[46px] text-right font-bold tabular-nums text-topic">
          {today.pop === null ? "—" : `${today.pop}%`}
        </span>
      </div>

      {rainy && (
        <div className="flex items-center gap-1.5 rounded-lg bg-topic-surface px-2.5 py-1.5 text-xs font-semibold text-topic">
          <Umbrella className="size-3.5" aria-hidden="true" />
          傘が要りそうです
        </div>
      )}

      {stale && <p className="text-xs text-muted">AIDE側の更新が止まっているため、古い予報の可能性があります。</p>}

      {tomorrow && (
        <div className="border-t border-dashed border-border pt-2 text-xs tabular-nums text-muted">
          明日 {tomorrow.summary}　{temp(tomorrow.max)} / {temp(tomorrow.min)}
          {tomorrow.pop !== null && `　降水 ${tomorrow.pop}%`}
        </div>
      )}

      {attribution && <p className="text-[0.625rem] text-muted">{attribution}</p>}
    </>
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
  return (
    <Card title="今日届いた通知">
      {pushes.length === 0 ? (
        <Empty>今日はまだ通知を送っていません。</Empty>
      ) : (
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
      )}
    </Card>
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
