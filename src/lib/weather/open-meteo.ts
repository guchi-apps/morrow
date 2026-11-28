import { DAY_RANGE } from "@/lib/dashboard/day-offset";
import { parseOpenMeteo, roundCoordinate, type Coordinates, type Forecast } from "@/lib/weather/rain-check";

/**
 * Open-Meteo（キー不要。AIDEの天気と同じ出典）から、時間別・日別の予報を取る（#586）。
 * 範囲はダッシュボードでめくれる前後の日（#606。`DAY_RANGE`）ぶんで、過去の日は `past_days` の値になる。1地点1回の取得のまま。
 *
 * 座標は小数2桁（≒1km）に丸めてから送る——現在地をそのまま外へ出さないためと、キャッシュの鍵を揃えるため。
 * 成功は30分持つ（AIDEの同期は毎時）。失敗は持たずに投げる。出典の表示（`OPEN_METEO_ATTRIBUTION`）を画面に添えること。
 *
 * 一時的な失敗（通信・時間切れ8秒・429・5xx）は少し待って1回だけ取り直す（#1087。合計14秒まで）。現在地は座標が毎回変わりキャッシュに
 * 当たらないため、1回の失敗がそのまま「取得できませんでした」になっていた。取り直しも失敗したら、期限切れでも
 * 直前の値（同じ地点・24時間以内）があればそれを返す。
 */

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const TTL_MS = 30 * 60 * 1000;
const TIMEOUT_MS = 8_000;
/** 取り直しを含めた待ち時間の上限。画面の描画を待たせすぎない */
const TOTAL_BUDGET_MS = 14_000;
/** 残りがこれより短ければ取り直さない */
const MIN_RETRY_MS = 2_000;
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
 * `task` には打ち切りまでの時間を渡す。取り直しは上限（`budgetMs`）の残りで行い、残りが `minRetryMs` 未満なら取り直さない。
 */
export async function withOneRetry<T>(
  task: (timeoutMs: number) => Promise<T>,
  { delayMs = RETRY_DELAY_MS, timeoutMs = TIMEOUT_MS, budgetMs = TOTAL_BUDGET_MS, minRetryMs = MIN_RETRY_MS, now = Date.now } = {},
): Promise<T> {
  const startedAt = now();
  try {
    return await task(Math.min(timeoutMs, budgetMs));
  } catch (error) {
    if (error instanceof ForecastFetchError && !error.retryable) throw error;
    const remaining = budgetMs - (now() - startedAt) - delayMs;
    if (remaining < minRetryMs) throw error;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return task(Math.min(timeoutMs, remaining));
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
    hourly: "weather_code,temperature_2m,precipitation_probability,precipitation,wind_speed_10m,wind_direction_10m",
    // 既定は km/h（#1239）
    wind_speed_unit: "ms",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "Asia/Tokyo",
    past_days: String(DAY_RANGE),
    forecast_days: String(DAY_RANGE + 1),
  });
  const fetchOnce = async (timeoutMs: number) => {
    const response = await fetch(`${FORECAST_URL}?${params}`, { signal: AbortSignal.timeout(timeoutMs) });
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
