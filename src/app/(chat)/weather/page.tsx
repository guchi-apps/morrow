import { Search } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { RainRadar } from "@/components/dashboard/rain-radar";
import { PlaceActions } from "@/components/weather/place-actions";
import { HourlyStrip, WeatherIcon, YesterdayNote } from "@/components/weather/hourly-strip";
import { getCurrentUser } from "@/lib/auth-user";
import { addDays, DAY_RANGE, dayDiff } from "@/lib/dashboard/day-offset";
import { dashboardHomePlace } from "@/lib/dashboard/places";
import { dayLabel, jstDayKey, jstTimeLabel } from "@/lib/day-key";
import { cn } from "@/lib/utils";
import { searchMunicipalities } from "@/lib/weather/geocode";
import { OPEN_METEO_ATTRIBUTION, forecastAt } from "@/lib/weather/open-meteo";
import { placeDayFrom, type PlaceDay } from "@/lib/weather/place-day";
import { MAX_WEATHER_PLACES, placeFromQuery, weatherHref, type WeatherPlaceInput } from "@/lib/weather/place-input";
import { listWeatherPlaces } from "@/lib/weather/places-store";
import { describeWeatherCode, type Forecast } from "@/lib/weather/rain-check";

// 予報は時間とともに変わるので、ビルド時の値を配らない。
export const dynamic = "force-dynamic";

export const metadata = { title: "天気" };

type Query = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const sameSpot = (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) =>
  a.latitude === b.latitude && a.longitude === b.longitude;
const temp = (value: number | null) => (value === null ? "—" : `${Math.round(value)}°`);

/**
 * 天気ページ（#695）。登録した地点（自宅は常に先頭）の一覧と地名検索、地点を選ぶとその日の0〜23時の
 * 気温・天気・降水確率・雨量。ダッシュボードの「時間と場所ごと」の地点名はここの詳細へ飛ぶ。
 *
 * 検索（`?q=`）は国土地理院の市町村の候補を並べるだけで、押すと詳細（登録していない地点も開ける）。登録は詳細のボタンから。
 * 日付は `?d=`（今日の前後 `DAY_RANGE` 日）。範囲外・読めない値は今日へ丸める。
 */
export default async function WeatherPage({ searchParams }: { searchParams: Promise<Query> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const query = await searchParams;
  const now = new Date();
  const today = jstDayKey(now);
  const requestedDay = first(query.d);
  const diff = requestedDay ? dayDiff(today, requestedDay) : 0;
  const offset = diff === null ? 0 : Math.max(-DAY_RANGE, Math.min(DAY_RANGE, diff));
  const date = addDays(today, offset);
  const q = (first(query.q) ?? "").trim().slice(0, 40);

  const [home, stored] = await Promise.all([dashboardHomePlace(user.id, now), listWeatherPlaces(user.id)]);
  const selected = placeFromQuery(query);

  // 検索の候補と、一覧の各地点の予報（日別の最高・最低）。どれも失敗しても画面は出す。
  const [search, forecasts] = await Promise.all([
    q
      ? searchMunicipalities(q).then(
          (found) => ({ ok: true as const, found }),
          () => ({ ok: false as const }),
        )
      : null,
    Promise.all(
      [...(home ? [home] : []), ...stored, ...(selected ? [selected] : [])].map(async (place) => {
        try {
          return [`${place.latitude},${place.longitude}`, await forecastAt(place)] as const;
        } catch {
          return [`${place.latitude},${place.longitude}`, null] as const;
        }
      }),
    ).then((entries) => new Map<string, Forecast | null>(entries)),
  ]);

  const entries: { place: WeatherPlaceInput; home: boolean; id: string }[] = [
    ...(home ? [{ place: home, home: true, id: "home" }] : []),
    ...stored.map((place) => ({ place, home: false, id: place.id })),
  ];
  const keyOf = (place: { latitude: number; longitude: number }) => `${place.latitude},${place.longitude}`;
  const isHome = selected && home ? sameSpot(selected, home) : false;
  const registered = selected ? stored.some((place) => sameSpot(place, selected)) : false;

  let detail: PlaceDay | null = null;
  const selectedForecast = selected ? (forecasts.get(keyOf(selected)) ?? null) : null;
  if (selected && selectedForecast) detail = placeDayFrom(selectedForecast, selected, date, isHome ? "home" : "away");

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-3.5 px-3.5 py-4 md:px-7 md:py-6">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-base font-bold tracking-tight">天気</h2>
          <span className="text-[0.6875rem] text-muted">{jstTimeLabel(now)} 時点・地点は{MAX_WEATHER_PLACES}件まで登録できます</span>
        </div>

        <form action="/weather" method="get" role="search" className="flex items-center gap-2">
          <span className="flex min-w-0 flex-1 items-center gap-1.5 rounded-[9px] border border-border bg-surface px-2.5">
            <Search className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
            <input
              type="search"
              name="q"
              defaultValue={q}
              maxLength={40}
              placeholder="市町村名で地点を探す（例：三条、草津）"
              aria-label="地名で検索"
              className="min-w-0 flex-1 bg-transparent py-2 text-[0.8125rem] outline-none placeholder:text-muted"
            />
          </span>
          <button
            type="submit"
            className="rounded-[9px] bg-foreground px-3.5 py-2 text-xs font-bold text-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            検索
          </button>
        </form>

        {search && (
          <section aria-label="検索結果" className="flex flex-col gap-1 rounded-xl border border-border bg-surface px-4 py-3">
            <h3 className="text-xs font-bold tracking-[0.06em] text-muted">「{q}」の検索結果</h3>
            {!search.ok ? (
              <p role="status" className="rounded-[10px] bg-danger-surface px-3 py-2 text-[0.8125rem] text-danger">
                検索できませんでした。時間をおいてやり直してください。
              </p>
            ) : search.found.length === 0 ? (
              <p className="text-[0.8125rem] text-muted">市町村が見つかりませんでした。「三条」「栗東市」のように市町村名で探してください。</p>
            ) : (
              <ul>
                {search.found.map((item) => (
                  <li key={`${item.latitude},${item.longitude}`} className="border-b border-border last:border-b-0">
                    <Link
                      href={weatherHref({ name: item.name, latitude: item.latitude, longitude: item.longitude })}
                      className="flex items-baseline justify-between gap-2 py-2 text-[0.8125rem] hover:underline"
                    >
                      <b>{item.name}</b>
                      <span className="text-xs text-muted">{item.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <div className="grid gap-3.5 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          <section aria-label="登録した地点" className="flex min-w-0 flex-col gap-1 self-start rounded-xl border border-border bg-surface px-3 py-3">
            <h3 className="px-1 pb-1 text-xs font-bold tracking-[0.06em] text-muted">登録した地点</h3>
            {entries.length === 0 && (
              <p className="px-1 text-[0.8125rem] text-muted">まだありません。上の検索から市町村を探して、登録してください。</p>
            )}
            <ul className="flex flex-col">
              {entries.map(({ place, home: isHomeEntry, id }) => {
                const daily = forecasts.get(keyOf(place))?.daily.find((day) => day.date === date) ?? null;
                const on = selected ? sameSpot(selected, place) : false;
                return (
                  <li key={id}>
                    <Link
                      href={weatherHref(place, date === today ? undefined : date)}
                      aria-current={on ? "page" : undefined}
                      className={cn(
                        "flex items-center justify-between gap-2 rounded-lg px-2 py-2 text-[0.8125rem] transition-colors hover:bg-rail-active focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent",
                        on && "bg-rail-active font-bold shadow-[inset_2px_0_0_var(--accent)]",
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <WeatherIcon code={daily?.code ?? null} className="size-3.5 shrink-0 text-topic" />
                        <span className="truncate">{place.name}</span>
                        {isHomeEntry && <span className="shrink-0 text-xs font-normal text-muted">・自宅</span>}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted">
                        {daily ? `${temp(daily.max)} / ${temp(daily.min)}` : "—"}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            {!home && (
              <p className="px-1 pt-1 text-[0.6875rem] text-muted">自宅の地点はAIDEから届くと、ここの先頭に出ます。</p>
            )}
          </section>

          <section aria-label="1日の天気" className="flex min-w-0 flex-col gap-2.5 rounded-xl border border-border bg-surface px-4 py-3.5">
            {!selected ? (
              <p className="text-[0.8125rem] text-muted">左の地点を選ぶと、その場所の0〜23時の天気が出ます。ダッシュボードの「時間と場所ごと」の地点名からも開けます。</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="flex items-baseline gap-2 text-base font-bold">
                    {selected.name}
                    {isHome && <span className="text-xs font-normal text-muted">・自宅</span>}
                  </h3>
                  {!isHome && (
                    <PlaceActions name={selected.name} latitude={selected.latitude} longitude={selected.longitude} registered={registered} />
                  )}
                </div>

                <div className="flex items-center justify-center gap-2.5 text-sm">
                  {offset > -DAY_RANGE ? (
                    <Link href={weatherHref(selected, addDays(date, -1))} replace aria-label="前の日" className="rounded-full border border-border px-3 py-0.5 hover:bg-rail-active">
                      ‹
                    </Link>
                  ) : (
                    <span className="rounded-full border border-border px-3 py-0.5 text-muted opacity-40" aria-hidden="true">‹</span>
                  )}
                  <b>{dayLabel(date)}</b>
                  {offset < DAY_RANGE ? (
                    <Link href={weatherHref(selected, addDays(date, 1))} replace aria-label="次の日" className="rounded-full border border-border px-3 py-0.5 hover:bg-rail-active">
                      ›
                    </Link>
                  ) : (
                    <span className="rounded-full border border-border px-3 py-0.5 text-muted opacity-40" aria-hidden="true">›</span>
                  )}
                  {offset !== 0 && (
                    <Link href={weatherHref(selected)} replace className="rounded-full border border-accent px-3 py-0.5 text-xs font-bold text-accent hover:bg-accent-surface">
                      今日へ
                    </Link>
                  )}
                </div>

                {!detail ? (
                  <p role="status" className="rounded-[10px] bg-danger-surface px-3 py-2.5 text-[0.8125rem] leading-relaxed text-danger">
                    この地点の天気を取得できませんでした。時間をおいて開き直してください。
                  </p>
                ) : (
                  <>
                    {detail.daily && (
                      <p className="flex flex-wrap items-center gap-x-3 text-[0.8125rem]">
                        <span className="flex items-center gap-1.5 font-bold">
                          <WeatherIcon code={detail.daily.code} className="size-4 text-topic" />
                          {describeWeatherCode(detail.daily.code)}
                        </span>
                        <span className="tabular-nums">
                          最高 <b className="text-accent">{temp(detail.daily.max)}</b> / 最低 <b className="text-topic">{temp(detail.daily.min)}</b>
                        </span>
                        {detail.daily.pop !== null && <span className="text-muted">降水 {detail.daily.pop}%</span>}
                      </p>
                    )}
                    <YesterdayNote cells={detail.cells} nowIndex={offset === 0 ? Number(jstTimeLabel(now).slice(0, 2)) : -1} />
                    <HourlyStrip
                      cells={detail.cells}
                      nowIndex={offset === 0 ? Number(jstTimeLabel(now).slice(0, 2)) : -1}
                      resetKey={`${keyOf(selected)}:${date}`}
                    />
                    <p className="text-[0.6875rem] text-muted">
                      青い地は降水確率50%以上。灰色は過ぎた時間。横にスクロールできます。{OPEN_METEO_ATTRIBUTION}
                    </p>
                    {offset === 0 ? (
                      <RainRadar key={keyOf(selected)} latitude={selected.latitude} longitude={selected.longitude} />
                    ) : (
                      <p className="border-t border-border pt-2.5 text-xs text-muted">
                        雨雲レーダーは今日の表示のときだけ出ます（実況と約15時間先までの予報のため）。
                      </p>
                    )}
                  </>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
