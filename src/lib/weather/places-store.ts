import { db } from "@/lib/db";
import { MAX_WEATHER_PLACES, type WeatherPlaceInput } from "@/lib/weather/place-input";

/**
 * 天気ページ（#695）の登録地点の保存。サーバー専用（Prismaを引く。判定・URLは純粋な `place-input.ts`）。
 * 自宅（AIDEの地点）はここに持たない。
 */

export type StoredPlace = WeatherPlaceInput & { id: string };

export async function listWeatherPlaces(userId: string): Promise<StoredPlace[]> {
  return db.weatherPlace.findMany({
    where: { userId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, name: true, latitude: true, longitude: true },
  });
}

/** 同じ地点（丸めた座標）が登録済みなら、そのまま成功（`added: false`）。上限なら `limit`。 */
export async function addWeatherPlace(userId: string, place: WeatherPlaceInput): Promise<{ ok: true; added: boolean } | { ok: false; reason: "limit" }> {
  const same = await db.weatherPlace.findUnique({
    where: { userId_latitude_longitude: { userId, latitude: place.latitude, longitude: place.longitude } },
    select: { id: true },
  });
  if (same) return { ok: true, added: false };
  if ((await db.weatherPlace.count({ where: { userId } })) >= MAX_WEATHER_PLACES) return { ok: false, reason: "limit" };
  try {
    await db.weatherPlace.create({ data: { userId, name: place.name, latitude: place.latitude, longitude: place.longitude } });
  } catch {
    // 同時の2リクエストで一意制約に当たった側。登録されていれば目的は果たしている。
    return { ok: true, added: false };
  }
  return { ok: true, added: true };
}

export async function removeWeatherPlace(userId: string, place: Pick<WeatherPlaceInput, "latitude" | "longitude">): Promise<boolean> {
  const result = await db.weatherPlace.deleteMany({ where: { userId, latitude: place.latitude, longitude: place.longitude } });
  return result.count > 0;
}
