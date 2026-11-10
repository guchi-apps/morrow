import { isValidCoordinates, roundCoordinate, type Coordinates } from "@/lib/weather/rain-check";

/**
 * 天気ページ（#695）の地点の入力と、URLの組み立て・読み取り。**純粋なモジュール**（`test/weather-place-input.test.ts`。
 * クライアントからもimportできるよう、PrismaにもNodeの機能にも触れない）。
 *
 * 地点は名前と座標の組で、**座標は小数2桁（≒1km）に丸めて持つ**（外へ送るのも同じ値。#586の方針）。
 * 詳細のURLは `/weather?n=<名前>&lat=<緯度>&lon=<経度>&d=<日付>`。登録していない地点（予定の行き先）も、
 * 座標を持ち回るだけで開ける（登録は詳細の「登録する」から）。
 */

/** 登録できる地点の数（自宅は含まない）。 */
export const MAX_WEATHER_PLACES = 8;
const NAME_MAX = 40;

export type WeatherPlaceInput = Coordinates & { name: string };

/** 名前の改行・制御文字を畳み、前後の空白を落とす。 */
export function cleanPlaceName(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim().slice(0, NAME_MAX);
}

/** 登録・詳細に渡された値を検証して丸める。足りない・範囲外・名前が空ならnull。 */
export function parsePlaceInput(value: { name?: unknown; latitude?: unknown; longitude?: unknown }): WeatherPlaceInput | null {
  const name = cleanPlaceName(value.name);
  const { latitude, longitude } = value;
  if (!name || !isValidCoordinates(latitude, longitude) || typeof longitude !== "number") return null;
  return { name, latitude: roundCoordinate(latitude), longitude: roundCoordinate(longitude) };
}

/** 詳細のパス。`date` が無ければ日付は付けない（今日）。 */
export function weatherHref(place: WeatherPlaceInput, date?: string): string {
  const params = new URLSearchParams({
    n: place.name,
    lat: String(roundCoordinate(place.latitude)),
    lon: String(roundCoordinate(place.longitude)),
  });
  if (date) params.set("d", date);
  return `/weather?${params.toString()}`;
}

/** 同名のときに「同じ地点」と見なす距離（度。0.1°≒約10km）。 */
const SAME_NAME_RADIUS_DEG = 0.1;

/**
 * 開いた地点が登録済みのどれにあたるかを探す（#868）。座標の完全一致（小数2桁）を優先し、無ければ
 * 同名かつ近接のものを採る。ダッシュボードの行き先は予定の場所欄を地名解決した座標で、検索から登録した
 * 座標と少しずれうるため、座標だけの一致だと同じ地名でも登録済みに見えなかった。
 */
export function findRegisteredPlace<T extends WeatherPlaceInput>(selected: WeatherPlaceInput, stored: readonly T[]): T | null {
  const exact = stored.find(
    (place) => roundCoordinate(place.latitude) === roundCoordinate(selected.latitude) && roundCoordinate(place.longitude) === roundCoordinate(selected.longitude),
  );
  if (exact) return exact;
  let best: T | null = null;
  let bestDistance = Infinity;
  for (const place of stored) {
    if (place.name !== selected.name) continue;
    const distance = Math.hypot(place.latitude - selected.latitude, place.longitude - selected.longitude);
    if (distance <= SAME_NAME_RADIUS_DEG && distance < bestDistance) {
      best = place;
      bestDistance = distance;
    }
  }
  return best;
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** URLの `n`・`lat`・`lon` から地点を読む。どれかが読めなければnull（一覧だけを出す）。 */
export function placeFromQuery(query: Record<string, string | string[] | undefined>): WeatherPlaceInput | null {
  const lat = first(query.lat);
  const lon = first(query.lon);
  if (!lat || !lon || !/^-?\d{1,3}(\.\d+)?$/.test(lat) || !/^-?\d{1,3}(\.\d+)?$/.test(lon)) return null;
  return parsePlaceInput({ name: first(query.n), latitude: Number(lat), longitude: Number(lon) });
}
