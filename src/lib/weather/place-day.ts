import { addDays } from "@/lib/dashboard/day-offset";
import type { HourCell } from "@/lib/dashboard/places";
import { forecastAt } from "@/lib/weather/open-meteo";
import { hourlyPoint, type DailyPoint, type Forecast } from "@/lib/weather/rain-check";
import type { WeatherPlaceInput } from "@/lib/weather/place-input";

/**
 * 天気ページ（#695）の、ある地点・ある日の0〜23時。ダッシュボードの帯（`HourCell`）と同じ形にして、
 * 気温の折れ線・1時間ごとの帯の部品をそのまま使う。予報は `forecastAt()` の30分キャッシュを使い回す（外への呼び出しは増えない）。
 * 前日の気温（`yesterday`）は、予報の範囲に前日があるときだけ入る。
 */

export type PlaceDay = { cells: HourCell[]; daily: DailyPoint | null };

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

export function placeDayFrom(forecast: Forecast, place: WeatherPlaceInput, date: string, kind: "home" | "away"): PlaceDay {
  const previous = addDays(date, -1);
  const cells = HOURS.map((hour): HourCell => {
    const found = hourlyPoint(forecast, date, hour);
    return {
      date,
      hour,
      placeLabel: place.name,
      placeKind: kind,
      code: found?.code ?? null,
      temperature: found?.temperature ?? null,
      yesterday: previous ? (hourlyPoint(forecast, previous, hour)?.temperature ?? null) : null,
      pop: found?.pop ?? null,
      precipitation: found?.precipitation ?? null,
    };
  });
  return { cells, daily: forecast.daily.find((day) => day.date === date) ?? null };
}

export async function placeDay(place: WeatherPlaceInput, date: string, kind: "home" | "away"): Promise<PlaceDay> {
  return placeDayFrom(await forecastAt(place), place, date, kind);
}

