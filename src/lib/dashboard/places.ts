import { jstDayKey } from "@/lib/day-key";
import { DAY_RANGE } from "@/lib/dashboard/day-offset";
import { cached, homeLocation, scheduleSource } from "@/lib/dashboard/aide";
import type { WeatherDay, WeatherLocation } from "@/lib/dashboard/parse";
import { resolvePlace } from "@/lib/weather/geocode";
import { forecastAt } from "@/lib/weather/open-meteo";
import {
  buildStays,
  describeWeatherCode,
  hourlyPoint,
  mergeOverlappingStays,
  placeAtHour,
  rainVerdict,
  summarizeWindow,
  type Coordinates,
  type RainVerdict,
  type Stay,
  type WindowWeather,
} from "@/lib/weather/rain-check";

/**
 * 時間と場所ごとの天気（#586）。今日の予定の移動・場所欄から区間を作り、区間ごとの天気と雨を付ける。
 * 明日・明後日は行き先の区間と、場所欄が空の予定から作った自宅の区間（#597）だけ（ダッシュボードでは折りたたみの中）。
 *
 * - 自宅の区間は、自宅の地点（AIDEの `location`。#1116から前回値を覚えている）のOpen-Meteoの時間別。地点が無い間は予報なし（`unresolved`）
 * - 行き先は国土地理院で市町村に決める。決められない地名は `unresolved`（天気は出さない）
 * - **区間1つの失敗で全体を落とさない**（その区間だけ `failed`）。「降らない」とは混ぜない（#214）
 * - 1時間ごとの帯（#594）は、各時間に居る区間（`placeAtHour()`）の地点の時間別予報。自宅の地点が無い間・場所不明の
 *   時間は予報なし（日別予報で代用しない）。今日・明日の0〜24時を持ち、「いまから24時間」の切り出しは描画側
 *
 * 結果は天気・予定と同じく利用者・日付ごとに5分持つ（`cached()`。失敗の全体は1分）。
 *
 * 今日以外の日（#606。`offset` ≠ 0）は、その日の区間（自宅込み）と、その日の0〜24時の帯だけを作る。
 * 明日以降の行き先は引かない（#625。「明日以降の雨を見る」を外したので、地名解決・予報取得の呼び出しも要らない）。
 */

export type PlaceSegment = Stay & {
  /** 市町村名。自宅はAIDEの地点の名前（無ければnull）、行き先は解決した名前。 */
  placeName: string | null;
  status: "ok" | "unresolved" | "failed";
  weather: WindowWeather | null;
  verdict: RainVerdict;
  /** 予報を取った地点（天気ページへのリンクに使う。場所不明・自宅の地点が未着の区間はnull。#695）。 */
  point: Coordinates | null;
};

/**
 * 1時間ごとの帯の1列（#594）。その時間に居る場所の予報（Open-Meteoの時間別）を出す。
 * 予報が無い（場所不明・自宅の地点が未着・取得失敗）時間は `code`〜`pop` がすべてnull。
 */
export type HourCell = {
  date: string;
  hour: number;
  /** 帯の上段に出す場所の名前（「栗東市・勤務（栗東）」「高槻市・自宅」「移動」）。隣と同じなら1本にまとめる。 */
  placeLabel: string;
  placeKind: "home" | "away" | "move";
  code: number | null;
  temperature: number | null;
  /** 前日の同じ時刻に、前日の予定で居た場所の気温（#651）。前日の予定・予報が取れなければnull。 */
  yesterday: number | null;
  pop: number | null;
  /** 1時間の降水量（mm）。 */
  precipitation: number | null;
  /** 風速（m/s）と、風が吹いてくる方角（度。#1239）。 */
  windSpeed: number | null;
  windDirection: number | null;
};

export type PlacesView =
  | { status: "unconnected" }
  | { status: "failed"; detail: string }
  | { status: "not_configured" }
  | {
      status: "ok";
      today: PlaceSegment[];
      /** 表示する日の0〜23時の1時間ごと（#620）。「今」の位置は描画側で決める（キャッシュに時刻を焼き込まない）。 */
      hourly: HourCell[];
      /** 予定の一部を取得できなかった（行き先が欠けているかもしれない）。 */
      partial: boolean;
    };

/** 自宅の地点（座標と名前）。地点が無ければ `point` がnull。 */
type Home = { point: Coordinates | null; name: string | null };

function homeOf(location: WeatherLocation | null): Home {
  const latitude = location?.latitude ?? null;
  const longitude = location?.longitude ?? null;
  return { point: latitude !== null && longitude !== null ? { latitude, longitude } : null, name: location?.name ?? null };
}

async function homeFor(userId: string, now: Date): Promise<{ status: "unconnected" } | { status: "ok"; home: Home; location: WeatherLocation | null }> {
  const view = await homeLocation(userId, now);
  return view.status === "ok" ? { status: "ok", home: homeOf(view.location), location: view.location } : view;
}

/** 区間と、その予報を取る地点（場所不明・自宅の地点が未着ならnull）。 */
type ResolvedSegment = { segment: PlaceSegment; point: Coordinates | null };

async function segmentFor(stay: Stay, home: Home): Promise<ResolvedSegment> {
  const base = { ...stay, placeName: null, weather: null, verdict: "unknown" as RainVerdict, point: null as Coordinates | null };
  try {
    if (stay.home) {
      // 自宅の地点が分からない間は予報を出さない（取れなかったのではなく、どこの予報か分からない）。
      if (!home.point) return { segment: { ...base, placeName: home.name, status: "unresolved" }, point: null };
      const summary = summarizeWindow(await forecastAt(home.point), stay.date, stay.start, stay.end);
      return {
        segment: { ...base, placeName: home.name, status: summary ? "ok" : "failed", weather: summary, verdict: rainVerdict(summary?.pop ?? null), point: home.point },
        point: home.point,
      };
    }

    const place = await resolvePlace(stay.placeText, home.point);
    if (!place) return { segment: { ...base, status: "unresolved" }, point: null };
    const summary = summarizeWindow(await forecastAt(place), stay.date, stay.start, stay.end);
    return {
      segment: { ...base, placeName: place.name, status: summary ? "ok" : "failed", weather: summary, verdict: rainVerdict(summary?.pop ?? null), point: { latitude: place.latitude, longitude: place.longitude } },
      point: place,
    };
  } catch (error) {
    console.error(`[aide-bot] 「${stay.placeText}」の天気を取得できなかった`, error);
    return { segment: { ...base, status: "failed" }, point: null };
  }
}

function segmentName(segment: PlaceSegment): string {
  if (segment.home) return segment.placeName ? `${segment.placeName}・自宅` : "自宅";
  const name = segment.placeName ?? "場所不明";
  return segment.label ? `${name}・${segment.label}` : name;
}

/**
 * 1日ぶんの区間から、`hours` の各時間の列を作る。場所の決め方は `placeAtHour()`（区間の中→その区間、
 * 移動中→次の区間の地点、最初の区間より前・最後の区間より後→自宅）。予報は区間ごとに取得済みのもの（30分キャッシュ）を使い回す。
 */
async function cellsFor(
  date: string,
  hours: number[],
  resolved: ResolvedSegment[],
  home: Home,
): Promise<HourCell[]> {
  const stays = resolved.map((item) => item.segment);
  return Promise.all(
    hours.map(async (hour): Promise<HourCell> => {
      const at = placeAtHour(stays, hour);
      const target = at.kind === "home" ? null : resolved[at.index];
      const point = target ? target.point : home.point;
      const placeLabel =
        at.kind === "move" ? "移動" : target ? segmentName(target.segment) : home.name ? `${home.name}・自宅` : "自宅";
      const placeKind = at.kind === "move" ? "move" : target && !target.segment.home ? "away" : "home";
      const empty = { date, hour, placeLabel, placeKind, code: null, temperature: null, yesterday: null, pop: null, precipitation: null, windSpeed: null, windDirection: null } as const;
      if (!point) return empty;
      try {
        const found = hourlyPoint(await forecastAt(point), date, hour);
        return found ? { ...empty, code: found.code, temperature: found.temperature, pop: found.pop, precipitation: found.precipitation, windSpeed: found.windSpeed, windDirection: found.windDirection } : empty;
      } catch {
        // 区間側で失敗は記録済み。帯ではその時間を「—」にするだけ。
        return empty;
      }
    }),
  );
}

/**
 * 表示日の前日に居た場所の気温（#651）。前日の予定から区間を作り直して同じ0〜23時の帯を引く。
 * 前日が予報の範囲外・予定が取れない・場所不明の時間はnull（自宅の日別予報などで代用しない）。
 */
async function yesterdayTemperatures(
  userId: string,
  now: Date,
  offset: number,
  home: Home,
): Promise<(number | null)[]> {
  const none = range(0, 24).map(() => null);
  if (offset - 1 < -DAY_RANGE) return none;
  try {
    const source = await scheduleSource(userId, now, offset - 1);
    if (source.status !== "ok" || source.json.configured === false) return none;
    const day = buildStays(source.json)?.[0];
    if (!day) return none;
    const resolved = await Promise.all(day.stays.map((stay) => segmentFor(stay, home)));
    const cells = await cellsFor(day.date, range(0, 24), resolved, home);
    return cells.map((cell) => cell.temperature);
  } catch (error) {
    console.error("[aide-bot] 前日の気温を取得できなかった", error);
    return none;
  }
}

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, index) => from + index);

export function dashboardPlaces(userId: string, now = new Date(), offset = 0): Promise<PlacesView> {
  return cached(`places:${userId}:${jstDayKey(now)}:${offset}`, async (): Promise<PlacesView> => {
    const [homeView, source] = await Promise.all([homeFor(userId, now), scheduleSource(userId, now, offset)]);
    if (source.status !== "ok") return source;
    if (source.json.configured === false) return { status: "not_configured" };

    const days = buildStays(source.json);
    if (!days) return { status: "failed", detail: "予定の応答に日付が入っていませんでした" };

    const home: Home = homeView.status === "ok" ? homeView.home : { point: null, name: null };
    const [today] = await Promise.all(
      days.slice(0, 1).map(async (day) => {
        const resolved = await Promise.all(day.stays.map((stay) => segmentFor(stay, home)));
        // カードの行は、同じ場所で重なる区間を1つにまとめて天気を取り直す（#608）。帯は元の区間（resolved）のまま。
        const merged = mergeOverlappingStays(day.stays);
        const cards =
          merged.length === day.stays.length
            ? resolved.map((item) => item.segment)
            : (await Promise.all(merged.map((stay) => segmentFor(stay, home)))).map((item) => item.segment);
        return { date: day.date, resolved, cards };
      }),
    );

    // 帯は表示する日の0〜23時だけ（#620。翌0時は出さない）。
    const [cells, yesterday] = today
      ? await Promise.all([
          cellsFor(today.date, range(0, 24), today.resolved, home),
          yesterdayTemperatures(userId, now, offset, home),
        ])
      : [[], []];
    const hourly = cells.map((cell, index) => ({ ...cell, yesterday: yesterday[index] ?? null }));

    return {
      status: "ok",
      today: today?.cards ?? [],
      hourly,
      partial: source.json.complete === false,
    };
  });
}

/**
 * 表示する日の自宅の1日の予報（#606・#1116）。AIDEの日別予報は読まず、自宅の地点のOpen-Meteoの日別から作る
 * （今日・明日も同じ。AIDEの同期が止まっても最新）。地点が届いていなければ `none`（その日の予報は分からない）。
 */
export type DayWeatherView =
  | { status: "unconnected" }
  | { status: "failed"; detail: string }
  | { status: "none" }
  | { status: "ok"; day: WeatherDay; location: WeatherLocation | null };

export async function dashboardDayWeather(userId: string, now: Date, date: string): Promise<DayWeatherView> {
  const view = await homeFor(userId, now);
  if (view.status !== "ok") return view;
  if (!view.home.point) return { status: "none" };
  try {
    const point = (await forecastAt(view.home.point)).daily.find((day) => day.date === date);
    if (!point) return { status: "none" };
    return {
      status: "ok",
      day: { date, summary: describeWeatherCode(point.code), max: point.max, min: point.min, pop: point.pop },
      location: view.location,
    };
  } catch (error) {
    console.error(`[aide-bot] ${date} の自宅の予報を取得できなかった`, error);
    return { status: "failed", detail: error instanceof Error ? error.message : "不明なエラー" };
  }
}

/** 天気ページの「自宅」（#695）。地点が無ければnull。名前が無ければ「自宅」。 */
export async function dashboardHomePlace(userId: string, now: Date): Promise<{ name: string; latitude: number; longitude: number } | null> {
  const view = await homeFor(userId, now);
  if (view.status !== "ok" || !view.home.point) return null;
  return { name: view.home.name ?? "自宅", ...view.home.point };
}
