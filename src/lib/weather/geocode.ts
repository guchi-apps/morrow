import {
  addressQueryOf,
  municipalityFromReverse,
  parseGsiSearch,
  parseMuniTable,
  pickMunicipality,
  roundCoordinate,
  type Coordinates,
  type ResolvedPlace,
} from "@/lib/weather/rain-check";

/**
 * 地名 ⇔ 座標を国土地理院から引く（#586）。**キーも依存も要らない**公開API。
 *
 * - 住所検索 `msearch.gsi.go.jp/address-search/AddressSearch?q=…`（地名 → 候補の座標と題）
 * - 逆ジオコーダ `mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress`（座標 → 市町村コード）
 * - 市町村コード表 `maps.gsi.go.jp/js/muni.js`（コード → 名前。約110KB）
 *
 * 結果はプロセス内に24時間持つ（地名は変わらない）。**解決できなかった（null）も持つ**——同じ「本社」を
 * 開くたびに引き直さない。通信の失敗は持たずに投げる（呼び出し側が「取得できませんでした」にする）。
 */

const SEARCH_URL = "https://msearch.gsi.go.jp/address-search/AddressSearch";
const REVERSE_URL = "https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress";
const MUNI_URL = "https://maps.gsi.go.jp/js/muni.js";
const TTL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 5_000;

type Entry<T> = { value: T; expiresAt: number };

const places = new Map<string, Entry<ResolvedPlace | null>>();
const reverses = new Map<string, Entry<string | null>>();
let muniTable: Entry<Map<string, string>> | null = null;

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`国土地理院が ${response.status} を返しました`);
  return response.json();
}

async function municipalityTable(): Promise<Map<string, string>> {
  if (muniTable && muniTable.expiresAt > Date.now()) return muniTable.value;
  const response = await fetch(MUNI_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`市町村コード表の取得が ${response.status} で失敗しました`);
  const table = parseMuniTable(await response.text());
  if (table.size === 0) throw new Error("市町村コード表を読めませんでした");
  muniTable = { value: table, expiresAt: Date.now() + TTL_MS };
  return table;
}

/** 座標の市町村名（「高槻市」「大阪市北区」）。海上など当たらなければnull。 */
export async function municipalityAt(point: Coordinates): Promise<string | null> {
  const latitude = roundCoordinate(point.latitude);
  const longitude = roundCoordinate(point.longitude);
  const key = `${latitude},${longitude}`;
  const hit = reverses.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const [json, table] = await Promise.all([
    fetchJson(`${REVERSE_URL}?lat=${latitude}&lon=${longitude}`),
    municipalityTable(),
  ]);
  const name = municipalityFromReverse(json, table);
  reverses.set(key, { value: name, expiresAt: Date.now() + TTL_MS });
  return name;
}

/**
 * 予定に書かれた地名を市町村に決める。決められなければnull（`pickMunicipality()` の注記）。
 * 住所が書かれていた場合は、先頭の候補の地点から逆ジオコーダで市町村名を引く。
 */
export async function resolvePlace(placeText: string, near: Coordinates | null): Promise<ResolvedPlace | null> {
  // 店名の付いた場所欄は丸ごとでは0件になるので、都道府県から後ろの住所で引く（#597）。
  const query = addressQueryOf(placeText);
  if (!query) return null;
  const key = `${query}|${near ? `${roundCoordinate(near.latitude)},${roundCoordinate(near.longitude)}` : ""}`;
  const hit = places.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const candidates = parseGsiSearch(await fetchJson(`${SEARCH_URL}?q=${encodeURIComponent(query)}`));
  let place = pickMunicipality(query, candidates, near);
  if (place && place.name === "") {
    const name = await municipalityAt(place);
    place = name ? { ...place, name } : null;
  }
  places.set(key, { value: place, expiresAt: Date.now() + TTL_MS });
  return place;
}
