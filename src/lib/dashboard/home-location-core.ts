import type { WeatherLocation } from "@/lib/dashboard/parse";

/**
 * 自宅の地点を覚えておく長さ（#1116）。地点（座標・市町村名）はAIDEの `aide_weather` が持つが、AIDEの同期が止まったり
 * AIDEへ届かなかったりしても、前回の地点でMorrowが予報を作れるようにする。自宅はめったに変わらないので長く持つ。
 */
export const HOME_LOCATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type RememberedLocation = { location: WeatherLocation; at: number };

export function hasPoint(location: WeatherLocation | null | undefined): location is WeatherLocation {
  return !!location && location.latitude !== null && location.longitude !== null;
}

/**
 * 今回AIDEから読めた地点（`fresh`）と覚えている地点から、使う地点を決める。座標つきで読めたらそれ、
 * 読めなかった（取得失敗・地点なしの応答）ときは期限内の覚えている地点、どちらも無ければ読めたもの（名前だけ・null）。
 * 純粋な関数（`test/home-location.test.ts`）。
 */
export function chooseHomeLocation(
  fresh: WeatherLocation | null,
  remembered: RememberedLocation | undefined,
  nowMs: number,
): WeatherLocation | null {
  if (hasPoint(fresh)) return fresh;
  if (remembered && nowMs - remembered.at < HOME_LOCATION_TTL_MS) return remembered.location;
  return fresh;
}
