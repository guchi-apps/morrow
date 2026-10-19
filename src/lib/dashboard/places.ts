import { jstDayKey } from "@/lib/day-key";
import { cached, dashboardWeather, scheduleSource } from "@/lib/dashboard/aide";
import type { WeatherView } from "@/lib/dashboard/parse";
import { resolvePlace } from "@/lib/weather/geocode";
import { forecastAt } from "@/lib/weather/open-meteo";
import {
  buildStays,
  rainVerdict,
  summarizeWindow,
  type Coordinates,
  type RainVerdict,
  type Stay,
  type WindowWeather,
} from "@/lib/weather/rain-check";

/**
 * 時間と場所ごとの天気（#586）。今日の予定の移動・場所欄から区間を作り、区間ごとの天気と雨を付ける。
 * 明日・明後日は行き先の区間だけ（ダッシュボードでは折りたたみの中）。
 *
 * - 自宅の区間は、AIDEが地点（`location` の座標）を返していればOpen-Meteoの時間別で、
 *   返していなければAIDEの日別予報（その日全体）で代用する（`daily: true`）
 * - 行き先は国土地理院で市町村に決める。決められない地名は `unresolved`（天気は出さない）
 * - **区間1つの失敗で全体を落とさない**（その区間だけ `failed`）。「降らない」とは混ぜない（#214）
 *
 * 結果は天気・予定と同じく利用者・日付ごとに5分持つ（`cached()`。失敗の全体は1分）。
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

export type PlacesView =
  | { status: "unconnected" }
  | { status: "failed"; detail: string }
  | { status: "not_configured" }
  | {
      status: "ok";
      today: PlaceSegment[];
      later: { date: string; segments: PlaceSegment[] }[];
      /** 予定の一部を取得できなかった（行き先が欠けているかもしれない）。 */
      partial: boolean;
    };

function homePoint(weather: WeatherView): Coordinates | null {
  if (weather.status !== "ok" || !weather.location) return null;
  const { latitude, longitude } = weather.location;
  return latitude !== null && longitude !== null ? { latitude, longitude } : null;
}

async function segmentFor(stay: Stay, weather: WeatherView, home: Coordinates | null): Promise<PlaceSegment> {
  const base = { ...stay, placeName: null, weather: null, verdict: "unknown" as RainVerdict, daily: false };
  try {
    if (stay.home) {
      const name = weather.status === "ok" ? (weather.location?.name ?? null) : null;
      if (home) {
        const summary = summarizeWindow(await forecastAt(home), stay.date, stay.start, stay.end);
        return { ...base, placeName: name, status: summary ? "ok" : "failed", weather: summary, verdict: rainVerdict(summary?.pop ?? null) };
      }
      // 地点が分からない間は、AIDEの日別予報（今日・明日）で代用する。
      const day =
        weather.status === "ok"
          ? [weather.today, weather.tomorrow].find((item) => item?.date === stay.date) ?? null
          : null;
      if (!day) return { ...base, placeName: name, status: "failed" };
      const summary = { summary: day.summary, min: day.min, max: day.max, pop: day.pop };
      return { ...base, placeName: name, status: "ok", weather: summary, verdict: rainVerdict(day.pop), daily: true };
    }

    const place = await resolvePlace(stay.placeText, home);
    if (!place) return { ...base, status: "unresolved" };
    const summary = summarizeWindow(await forecastAt(place), stay.date, stay.start, stay.end);
    return { ...base, placeName: place.name, status: summary ? "ok" : "failed", weather: summary, verdict: rainVerdict(summary?.pop ?? null) };
  } catch (error) {
    console.error(`[aide-bot] 「${stay.placeText}」の天気を取得できなかった`, error);
    return { ...base, status: "failed" };
  }
}

export function dashboardPlaces(userId: string, now = new Date()): Promise<PlacesView> {
  return cached(`places:${userId}:${jstDayKey(now)}`, async (): Promise<PlacesView> => {
    const [weather, source] = await Promise.all([dashboardWeather(userId, now), scheduleSource(userId, now)]);
    if (source.status !== "ok") return source;
    if (source.json.configured === false) return { status: "not_configured" };

    const days = buildStays(source.json);
    if (!days) return { status: "failed", detail: "予定の応答に日付が入っていませんでした" };

    const home = homePoint(weather);
    const [today, ...rest] = await Promise.all(
      days.map(async (day) => ({
        date: day.date,
        segments: await Promise.all(day.stays.map((stay) => segmentFor(stay, weather, home))),
      })),
    );

    return {
      status: "ok",
      today: today?.segments ?? [],
      later: rest,
      partial: source.json.complete === false,
    };
  });
}
