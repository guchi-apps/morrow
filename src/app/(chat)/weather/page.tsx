import { Check, ChevronRight, MapPin, Search } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { RainRadar } from "@/components/dashboard/rain-radar";
import { AutoLocate } from "@/components/weather/auto-locate";
import { PlaceActions } from "@/components/weather/place-actions";
import { DaySummaryPanel } from "@/components/weather/day-summary";
import { HourlyStrip, WeatherIcon } from "@/components/weather/hourly-strip";
import { getCurrentUser } from "@/lib/auth-user";
import { addDays, DAY_RANGE, dayDiff } from "@/lib/dashboard/day-offset";
import { dashboardHomePlace } from "@/lib/dashboard/places";
import { dayLabel, jstDayKey, jstTimeLabel } from "@/lib/day-key";
import { cn } from "@/lib/utils";
import {
  AREAS,
  areaById,
  areaHref,
  isRegisteredMunicipality,
  municipalitiesOf,
  prefecturesOf,
  registeredByPref,
  registeredInArea,
  type MuniEntry,
  type RegisteredSpot,
} from "@/lib/weather/area-picker";
import { municipalityAt, municipalityEntries, prefectureOfPoint, searchMunicipalities } from "@/lib/weather/geocode";
import { OPEN_METEO_ATTRIBUTION, forecastAt } from "@/lib/weather/open-meteo";
import { summarizeDay, type DaySummary } from "@/lib/weather/day-summary";
import { placeDayFrom, type PlaceDay } from "@/lib/weather/place-day";
import { HERE_NAME, MAX_WEATHER_PLACES, findRegisteredPlace, hereFromQuery, hereHref, placeFromQuery, shouldAutoLocate, weatherHref, type WeatherPlaceInput } from "@/lib/weather/place-input";
import { listWeatherPlaces } from "@/lib/weather/places-store";
import { describeWeatherCode, roundCoordinate, type Forecast } from "@/lib/weather/rain-check";

// 予報は時間とともに変わるので、ビルド時の値を配らない。
export const dynamic = "force-dynamic";

export const metadata = { title: "天気" };

type Query = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
// 選んだ地点はURL経由で小数2桁に丸まっている一方、自宅はAIDEの生の座標のまま来る（#754）。
// 厳密一致だと自宅だけ一致せず、一覧の強調・「自宅」表示が外れるので、丸めてから比べる。
const sameSpot = (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) =>
  roundCoordinate(a.latitude) === roundCoordinate(b.latitude) && roundCoordinate(a.longitude) === roundCoordinate(b.longitude);
/** 現在地を示すピン。文字の代わりに出すので、読み上げ用の名前を付ける（#1067） */
const HerePin = ({ className }: { className?: string }) => (
  <span role="img" aria-label="現在地" title="現在地" className={cn("inline-flex text-accent", className)}>
    <MapPin className="size-3.5" aria-hidden="true" />
  </span>
);
/**
 * 「エリアから選ぶ」の1行（#1096）。右端は登録済みの件数（0件は出さない）と開閉の矢印。
 * `open` の行を押すと閉じる（親の階層へ戻るリンク）。開閉はURLで持つ（全国の市町村をDOMに出さない）。
 */
const PickerRow = ({ href, open, count, depth, children }: { href: string; open: boolean; count: number; depth: 0 | 1; children: React.ReactNode }) => (
  <Link
    href={href}
    aria-expanded={open}
    className={cn(
      "flex items-center gap-2 border-b border-border py-3 pr-1.5 text-sm hover:bg-rail-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
      depth === 0 ? "pl-1.5" : "pl-5",
      open && "font-bold",
    )}
  >
    <span className="min-w-0 flex-1">{children}</span>
    {count > 0 && <span className="text-xs font-normal text-muted">{count}件登録</span>}
    <ChevronRight className={cn("size-4 shrink-0 transition-transform", open && "rotate-90")} aria-hidden="true" />
  </Link>
);
const PickerCity = ({ href, registered, children }: { href: string; registered: boolean; children: React.ReactNode }) => (
  <Link
    href={href}
    className={cn(
      "flex items-center gap-2 border-b border-border py-2.5 pl-9 pr-1.5 text-[0.8125rem] hover:bg-rail-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
      registered && "bg-rail-active",
    )}
  >
    <span className="min-w-0 flex-1">{children}</span>
    {registered && (
      <span role="img" aria-label="登録済み" title="登録済み" className="inline-flex text-accent">
        <Check className="size-4" aria-hidden="true" />
      </span>
    )}
    <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden="true" />
  </Link>
);
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

  // 「エリアから選ぶ」（#1079）。エリア→都道府県→市町村。市町村を押したら座標へ解決して詳細へ移す
  const pickerOpen = first(query.picker) === "1";
  const pickerArea = areaById(first(query.area));
  const pickerPref = Number(first(query.pref));
  const pickerCity = (first(query.city) ?? "").slice(0, 30);
  let muni: MuniEntry[] | null = null;
  let pickerError = false;
  if (pickerOpen) {
    try {
      muni = await municipalityEntries();
    } catch {
      pickerError = true;
    }
  }
  if (muni && pickerCity && Number.isInteger(pickerPref)) {
    const entry = municipalitiesOf(pickerPref, muni).find((item) => item.name === pickerCity);
    const found = entry ? await searchMunicipalities(`${entry.prefecture}${entry.name}`).catch(() => []) : [];
    // 同名の市（府中市など）で別の県を拾わないよう、題が選んだ県で始まるものだけを採る
    const hit = entry ? found.find((item) => item.name === pickerCity && item.title.startsWith(entry.prefecture)) : undefined;
    if (hit) redirect(weatherHref({ name: hit.name, latitude: hit.latitude, longitude: hit.longitude }));
    pickerError = true;
  }

  const [home, stored] = await Promise.all([dashboardHomePlace(user.id, now), listWeatherPlaces(user.id)]);
  // 「エリアから選ぶ」の登録済み表示（#1096）。登録地点（自宅を含む）の座標から都道府県を引く。引けない地点は数えない
  const registeredSpots: RegisteredSpot[] = [];
  if (pickerOpen && muni) {
    const found = await Promise.all(
      [...(home ? [home] : []), ...stored].map((place) => prefectureOfPoint(place).catch(() => null)),
    );
    for (const spot of found) if (spot) registeredSpots.push(spot);
  }
  const registeredCounts = registeredByPref(registeredSpots);
  // 現在地（#882）。座標はブラウザが取ってURLへ載せたもので、市町村名だけサーバーで引く（引けなくても予報は出す）
  const hereSpot = hereFromQuery(query);
  const hereName = hereSpot ? await municipalityAt(hereSpot).catch(() => null) : null;
  const selected = hereSpot ? { ...hereSpot, name: hereName ?? HERE_NAME } : placeFromQuery(query);
  const isHere = hereSpot !== null;

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

  // 現在地が自宅・登録地点と同じ場所なら、別行にせずその行へまとめる（#1067）。GPSとAIDEの座標は約1kmずれうるので、
  // 丸め座標の一致に加え、同名（現在地の市町村名が引けた場合のみ）で近接する地点も同じ場所とみなす（findRegisteredPlace）。
  const hereMergedWith =
    selected && isHere
      ? (findRegisteredPlace(selected, [...(home ? [{ ...home, id: "home" }] : []), ...stored])?.id ?? null)
      : null;
  const entries: { place: WeatherPlaceInput; home: boolean; id: string; here: boolean }[] = [
    ...(selected && isHere && hereMergedWith === null ? [{ place: selected, home: false, id: "here", here: true }] : []),
    ...(home ? [{ place: home, home: true, id: "home", here: hereMergedWith === "home" }] : []),
    ...stored.map((place) => ({ place, home: false, id: place.id, here: hereMergedWith === place.id })),
  ];
  const keyOf = (place: { latitude: number; longitude: number }) => `${place.latitude},${place.longitude}`;
  const isHome = !isHere && selected && home ? sameSpot(selected, home) : false;
  const registeredPlace = selected && !isHome && !isHere ? findRegisteredPlace(selected, stored) : null;
  const registered = registeredPlace !== null;

  // 今日の前後 DAY_RANGE 日を1本の帯に連結する（#869。日付をまたいで左右スクロールで続けて見られる）
  const days = Array.from({ length: DAY_RANGE * 2 + 1 }, (_, i) => addDays(today, i - DAY_RANGE));
  let detail: { cells: PlaceDay["cells"]; byDate: Map<string, PlaceDay> } | null = null;
  const selectedForecast = selected ? (forecasts.get(keyOf(selected)) ?? null) : null;
  if (selected && selectedForecast) {
    const byDate = new Map(days.map((day) => [day, placeDayFrom(selectedForecast, selected, day, isHome || hereMergedWith === "home" ? "home" : "away")] as const));
    detail = { cells: [...byDate.values()].flatMap((d) => d.cells), byDate };
  }
  const nowIndex = DAY_RANGE * 24 + Number(jstTimeLabel(now).slice(0, 2));
  // 日付のラベル。最上段に出す（天気・最高/最低は上部の DaySummaryPanel が出す。#1078）
  const dateBands = detail ? Object.fromEntries([...detail.byDate.keys()].map((day) => [day, dayLabel(day)])) : null;
  // ダッシュボードの地点名から今日以外の日で開いたときは、その日の0時から見せる
  const focusIndex = offset === 0 ? undefined : (days.indexOf(date) as number) * 24;
  const dayName = (day: string) => (day === today ? "今日" : day === addDays(today, 1) ? "明日" : day === addDays(today, -1) ? "昨日" : "");
  const summaries: Record<string, DaySummary> = {};
  if (detail && selectedForecast) {
    for (const day of days) {
      const previous = addDays(day, -1);
      summaries[day] = summarizeDay(
        detail.byDate.get(day)?.daily ?? null,
        selectedForecast.daily.find((point) => point.date === previous) ?? null,
        { date: day, label: `${dayName(day)} ${dayLabel(day)}`.trim(), condition: describeWeatherCode(detail.byDate.get(day)?.daily?.code ?? null) },
      );
    }
  }

  return (
    <div className="mobile-tab-pad min-h-0 flex-1 overflow-y-auto">
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
              placeholder="市町村名で地点を探す"
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
          <Link
            href={pickerOpen ? "/weather" : areaHref({})}
            aria-expanded={pickerOpen}
            className="rounded-[9px] border border-border bg-surface px-3 py-2 text-xs font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            エリアから選ぶ
          </Link>
        </form>

        {pickerOpen && (
          <section aria-label="エリアから選ぶ" className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface px-4 py-3">
            <h3 className="text-xs font-bold tracking-[0.06em] text-muted">エリアから選ぶ（押すとその地点の天気を開きます）</h3>
            {pickerError || !muni ? (
              <p role="status" className="rounded-[10px] bg-danger-surface px-3 py-2 text-[0.8125rem] text-danger">
                市町村の一覧を取得できませんでした。時間をおいてやり直してください。
              </p>
            ) : (
              <>
                <div className="border-t border-border">
                  {AREAS.map((area) => {
                    const areaOpen = pickerArea?.id === area.id;
                    return (
                      <div key={area.id}>
                        <PickerRow
                          href={areaOpen ? areaHref({}) : areaHref({ area: area.id })}
                          open={areaOpen}
                          count={registeredInArea(area, registeredCounts)}
                          depth={0}
                        >
                          {area.label}
                        </PickerRow>
                        {areaOpen &&
                          prefecturesOf(area, muni).map((pref) => {
                            const prefOpen = pickerPref === pref.code;
                            return (
                              <div key={pref.code}>
                                <PickerRow
                                  href={prefOpen ? areaHref({ area: area.id }) : areaHref({ area: area.id, pref: pref.code })}
                                  open={prefOpen}
                                  count={registeredCounts.get(pref.code) ?? 0}
                                  depth={1}
                                >
                                  {pref.name}
                                </PickerRow>
                                {prefOpen &&
                                  municipalitiesOf(pref.code, muni).map((item) => (
                                    <PickerCity
                                      key={item.name}
                                      href={areaHref({ area: area.id, pref: pref.code, city: item.name })}
                                      registered={isRegisteredMunicipality(item, registeredSpots)}
                                    >
                                      {item.name}
                                    </PickerCity>
                                  ))}
                              </div>
                            );
                          })}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        )}

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
              {entries.map(({ place, home: isHomeEntry, id, here: isHereEntry }) => {
                const daily = forecasts.get(keyOf(place))?.daily.find((day) => day.date === date) ?? null;
                const on = selected
                  ? isHereEntry
                    ? isHere
                    : isHomeEntry
                      ? !isHere && sameSpot(selected, place)
                      : registeredPlace?.id === id
                  : false;
                return (
                  <li key={id}>
                    <Link
                      href={isHereEntry ? hereHref(id === "here" ? place : { latitude: hereSpot!.latitude, longitude: hereSpot!.longitude }, date === today ? undefined : date) : weatherHref(place, date === today ? undefined : date)}
                      aria-current={on ? "page" : undefined}
                      className={cn(
                        "flex items-center justify-between gap-2 rounded-lg px-2 py-2 text-[0.8125rem] transition-colors hover:bg-rail-active focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent",
                        on && "bg-rail-active font-bold outline-1 outline-foreground/45 -outline-offset-1",
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        {on && <Check className="size-3.5 shrink-0" aria-hidden="true" />}
                        <WeatherIcon code={daily?.code ?? null} className="size-3.5 shrink-0 text-topic" />
                        {isHereEntry && <HerePin className="shrink-0" />}
                        {!(id === "here" && place.name === HERE_NAME) && <span className="truncate">{place.name}</span>}
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
              shouldAutoLocate(query) ? (
                <AutoLocate date={offset === 0 ? undefined : date} />
              ) : (
                <p className="text-[0.8125rem] text-muted">左の地点を選ぶと、その場所の0〜23時の天気が出ます。ダッシュボードの「時間と場所ごと」の地点名からも開けます。</p>
              )
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="flex items-baseline gap-2 text-base font-bold">
                    {selected.name}
                    {isHere && <HerePin />}
                  </h3>
                  {!isHome && !isHere && (
                    <PlaceActions
                      name={registeredPlace?.name ?? selected.name}
                      latitude={registeredPlace?.latitude ?? selected.latitude}
                      longitude={registeredPlace?.longitude ?? selected.longitude}
                      registered={registered}
                    />
                  )}
                </div>

                {!detail ? (
                  <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] bg-danger-surface px-3 py-2.5 text-[0.8125rem] leading-relaxed text-danger">
                    <span>この地点の天気を取得できませんでした。時間をおいてもう一度取得してください。</span>
                    {/* 現在地は位置から取り直す（素の /weather）。素の <a> で開き直し、予報も取り直させる（#1087） */}
                    <a
                      href={isHere ? (offset === 0 ? "/weather" : `/weather?d=${date}`) : weatherHref(selected, offset === 0 ? undefined : date)}
                      className="shrink-0 rounded-[9px] border border-danger/40 bg-surface px-3 py-1 text-xs font-bold text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    >
                      もう一度取得
                    </a>
                  </div>
                ) : (
                  <>
                    <DaySummaryPanel summaries={summaries} days={days} initialDate={date} resetKey={`${keyOf(selected)}:${date}`}>
                      <HourlyStrip
                        cells={detail.cells}
                        nowIndex={nowIndex}
                        resetKey={`${keyOf(selected)}:${date}`}
                        dateBands={dateBands ?? undefined}
                        focusIndex={focusIndex}
                      />
                    </DaySummaryPanel>
                    <p className="text-[0.6875rem] text-muted">
                      青い地は降水確率50%以上。灰色は過ぎた時間。左右にスクロールすると前後の日も続けて見られます。{OPEN_METEO_ATTRIBUTION}
                    </p>
                    <RainRadar key={keyOf(selected)} latitude={selected.latitude} longitude={selected.longitude} centerLabel={selected.name} />
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
