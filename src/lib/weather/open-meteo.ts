import { DAY_RANGE } from "@/lib/dashboard/day-offset";
import { parseOpenMeteo, roundCoordinate, type Coordinates, type Forecast } from "@/lib/weather/rain-check";

/**
 * Open-Meteo（キー不要。AIDEの天気と同じ出典）から、時間別・日別の予報を取る（#586）。
 * 範囲はダッシュボードでめくれる前後の日（#606。`DAY_RANGE`）ぶんで、過去の日は `past_days` の値になる。1地点1回の取得のまま。
 *
 * 座標は小数2桁（≒1km）に丸めてから送る——現在地をそのまま外へ出さないためと、キャッシュの鍵を揃えるため。
 * 成功は30分持つ（AIDEの同期は毎時）。失敗は持たずに投げる。出典の表示（`OPEN_METEO_ATTRIBUTION`）を画面に添えること。
 */

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const TTL_MS = 30 * 60 * 1000;
const TIMEOUT_MS = 6_000;

export const OPEN_METEO_ATTRIBUTION = "Weather data by Open-Meteo.com (CC BY 4.0)";

const cache = new Map<string, { value: Forecast; expiresAt: number }>();
const inFlight = new Map<string, Promise<Forecast>>();

export function forecastAt(point: Coordinates): Promise<Forecast> {
  const latitude = roundCoordinate(point.latitude);
  const longitude = roundCoordinate(point.longitude);
  const key = `${latitude},${longitude}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.value);
  const running = inFlight.get(key);
  if (running) return running;

  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    hourly: "weather_code,temperature_2m,precipitation_probability,precipitation",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "Asia/Tokyo",
    past_days: String(DAY_RANGE),
    forecast_days: String(DAY_RANGE + 1),
  });
  const promise = (async () => {
    const response = await fetch(`${FORECAST_URL}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`Open-Meteoが ${response.status} を返しました`);
    const forecast = parseOpenMeteo(await response.json());
    if (!forecast) throw new Error("Open-Meteoの予報を読めませんでした");
    cache.set(key, { value: forecast, expiresAt: Date.now() + TTL_MS });
    return forecast;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}
