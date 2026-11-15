import { dashboardHomePlace } from "@/lib/dashboard/places";
import { jstDayKey } from "@/lib/day-key";
import { formatWeatherContext, mentionsWeather, type WeatherContext } from "@/lib/weather/chat-context-core";
import { municipalityAt } from "@/lib/weather/geocode";
import { forecastAt } from "@/lib/weather/open-meteo";
import type { Coordinates } from "@/lib/weather/rain-check";

/**
 * Hermesのチャットで天気について聞かれたとき、現在地（無ければ自宅）の予報を発言の先頭へ添える（#930）。**サーバー専用。**
 *
 * - 現在地はブラウザが送った座標（丸め済み）。保存もログ出力もしない。市町村名は国土地理院の逆ジオコーダで引く（引けなければ「現在地」）
 * - 現在地が無ければ自宅（AIDEの地点）。自宅も無ければnull（従来どおりHermesに任せる）
 * - 失敗してもターンは止めない（nullを返す）。戻りが null ＝ 何も添えない
 */

export async function weatherContextFor(userId: string, text: string, here: Coordinates | null): Promise<WeatherContext | null> {
  if (!mentionsWeather(text)) return null;
  try {
    const now = new Date();
    const today = jstDayKey(now);
    if (here) {
      const [forecast, name] = await Promise.all([forecastAt(here), municipalityAt(here).catch(() => null)]);
      return formatWeatherContext({ source: "here", placeName: name ?? "現在地", forecast, today });
    }
    const home = await dashboardHomePlace(userId, now);
    if (!home) return null;
    return formatWeatherContext({ source: "home", placeName: home.name, forecast: await forecastAt(home), today });
  } catch (error) {
    console.error("[aide-bot] チャットに添える天気を用意できなかった", error instanceof Error ? error.message : error);
    return null;
  }
}
