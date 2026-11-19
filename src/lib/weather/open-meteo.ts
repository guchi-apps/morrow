import { DAY_RANGE } from "@/lib/dashboard/day-offset";
import { parseOpenMeteo, roundCoordinate, type Coordinates, type Forecast } from "@/lib/weather/rain-check";

/**
 * Open-Meteo（キー不要。AIDEの天気と同じ出典）から、時間別・日別の予報を取る（#586）。
 * 範囲はダッシュボードでめくれる前後の日（#606。`DAY_RANGE`）ぶんで、過去の日は `past_days` の値になる。1地点1回の取得のまま。
 *
 * 座標は小数2桁（≒1km）に丸めてから送る——現在地をそのまま外へ出さないためと、キャッシュの鍵を揃えるため。
 * 成功は30分持つ（AIDEの同期は毎時）。失敗は持たずに投げる。出典の表示（`OPEN_METEO_ATTRIBUTION`）を画面に添えること。
 *
 * 一時的な失敗（通信・時間切れ・429・5xx）は少し待って1回だけ取り直す（#1087）。現在地は座標が毎回変わりキャッシュに
 * 当たらないため、1回の失敗がそのまま「取得できませんでした」になっていた。取り直しも失敗したら、期限切れでも
 * 直前の値（同じ地点・24時間以内）があればそれを返す。
 */

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const TTL_MS = 30 * 60 * 1000;
const TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 700;
/** 取り直しも失敗したとき、期限切れの値を代わりに使ってよい古さ */
const STALE_MS = 24 * 60 * 60 * 1000;

export const OPEN_METEO_ATTRIBUTION = "Weather data by Open-Meteo.com (CC BY 4.0)";

const cache = new Map<string, { value: Forecast; expiresAt: number }>();
const inFlight = new Map<string, Promise<Forecast>>();

/** 取得の失敗。`retryable` は取り直す価値がある（通信・時間切れ・429・5xx）か */
export class ForecastFetchError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "ForecastFetchError";
    this.retryable = retryable;
  }
}

/** HTTPの状態から、取り直す価値があるか。429と5xxだけ（4xxは同じ要求を送り直しても変わらない） */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * 1回だけ取り直す。`ForecastFetchError` で `retryable: false` のものは取り直さない。それ以外の例外（通信・打ち切り）は取り直す。
 */
export async function withOneRetry<T>(task: () => Promise<T>, delayMs = RETRY_DELAY_MS): Promise<T> {
  try {
    return await task();
  } catch (error) {
    if (error instanceof ForecastFetchError && !error.retryable) throw error;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return task();
  }
}

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
  const fetchOnce = async () => {
    const response = await fetch(`${FORECAST_URL}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new ForecastFetchError(`Open-Meteoが ${response.status} を返しました`, isRetryableStatus(response.status));
    const forecast = parseOpenMeteo(await response.json());
    if (!forecast) throw new ForecastFetchError("Open-Meteoの予報を読めませんでした", false);
    return forecast;
  };
  const promise = withOneRetry(fetchOnce)
    .then((forecast) => {
      cache.set(key, { value: forecast, expiresAt: Date.now() + TTL_MS });
      return forecast;
    })
    .catch((error: unknown) => {
      // 地点の座標（小数2桁）は出すが、利用者は出さない
      console.warn(`[weather] Open-Meteoの取得に失敗しました（${key}）: ${error instanceof Error ? error.message : String(error)}`);
      if (hit && hit.expiresAt + STALE_MS - TTL_MS > Date.now()) return hit.value;
      throw error;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}
