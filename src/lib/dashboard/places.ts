import { jstDayKey } from "@/lib/day-key";
import { cached, dashboardWeather, scheduleSource } from "@/lib/dashboard/aide";
import type { WeatherDay, WeatherLocation, WeatherView } from "@/lib/dashboard/parse";
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
  weatherCodeOfText,
  type Coordinates,
  type RainVerdict,
  type Stay,
  type WindowWeather,
} from "@/lib/weather/rain-check";

/**
 * 時間と場所ごとの天気（#586）。今日の予定の移動・場所欄から区間を作り、区間ごとの天気と雨を付ける。
 * 明日・明後日は行き先の区間と、場所欄が空の予定から作った自宅の区間（#597）だけ（ダッシュボードでは折りたたみの中）。
 *
 * - 自宅の区間は、AIDEが地点（`location` の座標）を返していればOpen-Meteoの時間別で、
 *   返していなければAIDEの日別予報（その日全体）で代用する（`daily: true`）
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
  /** 自宅の区間をAIDEの日別予報（1日全体）で代用した。 */
  daily: boolean;
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
  pop: number | null;
  /** 1時間の降水量（mm）。 */
  precipitation: number | null;
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

function homePoint(weather: WeatherView): Coordinates | null {
  if (weather.status !== "ok" || !weather.location) return null;
  const { latitude, longitude } = weather.location;
  return latitude !== null && longitude !== null ? { latitude, longitude } : null;
}

/** 区間と、その予報を取る地点（場所不明・自宅の地点が未着ならnull）。 */
type ResolvedSegment = { segment: PlaceSegment; point: Coordinates | null };

async function segmentFor(stay: Stay, weather: WeatherView, home: Coordinates | null): Promise<ResolvedSegment> {
  const base = { ...stay, placeName: null, weather: null, verdict: "unknown" as RainVerdict, daily: false };
  try {
    if (stay.home) {
      const name = weather.status === "ok" ? (weather.location?.name ?? null) : null;
      if (home) {
        const summary = summarizeWindow(await forecastAt(home), stay.date, stay.start, stay.end);
        return {
          segment: { ...base, placeName: name, status: summary ? "ok" : "failed", weather: summary, verdict: rainVerdict(summary?.pop ?? null) },
          point: home,
        };
      }
      // 地点が分からない間は、AIDEの日別予報（今日・明日）で代用する。
      const day =
        weather.status === "ok"
          ? [weather.today, weather.tomorrow].find((item) => item?.date === stay.date) ?? null
          : null;
      // AIDEの日別予報は今日・明日だけ。それ以外の日（#606）は取れなかったのではなく、分からない。
      if (!day) return { segment: { ...base, placeName: name, status: weather.status === "ok" ? "unresolved" : "failed" }, point: null };
      const summary = { summary: day.summary, code: weatherCodeOfText(day.summary), min: day.min, max: day.max, pop: day.pop, rainFrom: null };
      return {
        segment: { ...base, placeName: name, status: "ok", weather: summary, verdict: rainVerdict(day.pop), daily: true },
        point: null,
      };
    }

    const place = await resolvePlace(stay.placeText, home);
    if (!place) return { segment: { ...base, status: "unresolved" }, point: null };
    const summary = summarizeWindow(await forecastAt(place), stay.date, stay.start, stay.end);
    return {
      segment: { ...base, placeName: place.name, status: summary ? "ok" : "failed", weather: summary, verdict: rainVerdict(summary?.pop ?? null) },
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
  home: Coordinates | null,
  homeName: string | null,
): Promise<HourCell[]> {
  const stays = resolved.map((item) => item.segment);
  return Promise.all(
    hours.map(async (hour): Promise<HourCell> => {
      const at = placeAtHour(stays, hour);
      const target = at.kind === "home" ? null : resolved[at.index];
      const point = target ? target.point : home;
      const placeLabel =
        at.kind === "move" ? "移動" : target ? segmentName(target.segment) : homeName ? `${homeName}・自宅` : "自宅";
      const placeKind = at.kind === "move" ? "move" : target && !target.segment.home ? "away" : "home";
      const empty = { date, hour, placeLabel, placeKind, code: null, temperature: null, pop: null, precipitation: null } as const;
      if (!point) return empty;
      try {
        const found = hourlyPoint(await forecastAt(point), date, hour);
        return found ? { ...empty, code: found.code, temperature: found.temperature, pop: found.pop, precipitation: found.precipitation } : empty;
      } catch {
        // 区間側で失敗は記録済み。帯ではその時間を「—」にするだけ。
        return empty;
      }
    }),
  );
}

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, index) => from + index);

export function dashboardPlaces(userId: string, now = new Date(), offset = 0): Promise<PlacesView> {
  return cached(`places:${userId}:${jstDayKey(now)}:${offset}`, async (): Promise<PlacesView> => {
    const [weather, source] = await Promise.all([dashboardWeather(userId, now), scheduleSource(userId, now, offset)]);
    if (source.status !== "ok") return source;
    if (source.json.configured === false) return { status: "not_configured" };

    const days = buildStays(source.json);
    if (!days) return { status: "failed", detail: "予定の応答に日付が入っていませんでした" };

    const home = homePoint(weather);
    const homeName = weather.status === "ok" ? (weather.location?.name ?? null) : null;
    const [today] = await Promise.all(
      days.slice(0, 1).map(async (day) => {
        const resolved = await Promise.all(day.stays.map((stay) => segmentFor(stay, weather, home)));
        // カードの行は、同じ場所で重なる区間を1つにまとめて天気を取り直す（#608）。帯は元の区間（resolved）のまま。
        const merged = mergeOverlappingStays(day.stays);
        const cards =
          merged.length === day.stays.length
            ? resolved.map((item) => item.segment)
            : (await Promise.all(merged.map((stay) => segmentFor(stay, weather, home)))).map((item) => item.segment);
        return { date: day.date, resolved, cards };
      }),
    );

    // 帯は表示する日の0〜23時だけ（#620。翌0時は出さない）。
    const hourly = today ? await cellsFor(today.date, range(0, 24), today.resolved, home, homeName) : [];

    return {
      status: "ok",
      today: today?.cards ?? [],
      hourly,
      partial: source.json.complete === false,
    };
  });
}

/**
 * 表示する日の自宅の1日の予報（#606）。今日・明日はAIDEの日別予報、それ以外の日（と、深夜でAIDEの明日がまだ無いとき）は
 * 自宅の地点のOpen-Meteoの日別。地点がAIDEから届いていなければ `none`（その日の予報は分からない）。
 */
export type DayWeatherView =
  | { status: "unconnected" }
  | { status: "failed"; detail: string }
  | { status: "unavailable"; reason: string | null }
  | { status: "none" }
  | { status: "ok"; day: WeatherDay; stale: boolean; attribution: string | null; location: WeatherLocation | null };

export async function dashboardDayWeather(userId: string, now: Date, date: string): Promise<DayWeatherView> {
  const weather = await dashboardWeather(userId, now);
  if (weather.status !== "ok") return weather;
  const { stale, attribution, location } = weather;
  const aide = [weather.today, weather.tomorrow].find((day) => day?.date === date);
  if (aide) return { status: "ok", day: aide, stale, attribution, location };

  const home = homePoint(weather);
  if (!home) return { status: "none" };
  try {
    const point = (await forecastAt(home)).daily.find((day) => day.date === date);
    if (!point) return { status: "none" };
    return {
      status: "ok",
      day: { date, summary: describeWeatherCode(point.code), max: point.max, min: point.min, pop: point.pop },
      stale: false,
      attribution: null,
      location,
    };
  } catch (error) {
    console.error(`[aide-bot] ${date} の自宅の予報を取得できなかった`, error);
    return { status: "failed", detail: error instanceof Error ? error.message : "不明なエラー" };
  }
}
