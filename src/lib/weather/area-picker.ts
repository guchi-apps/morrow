/**
 * 天気ページの「エリアから選ぶ」（#1079）。エリア → 都道府県 → 市町村と絞り込む。純粋な部分だけをここに置く
 * （`test/weather-area-picker.test.ts`）。市町村の一覧は国土地理院の市町村コード表（`muni.js`）から引く。
 */

export type Area = { id: string; label: string; prefectures: readonly number[] };

/** 都道府県コード（1〜47）でまとめたエリア。 */
export const AREAS: readonly Area[] = [
  { id: "tohoku", label: "北海道・東北", prefectures: [1, 2, 3, 4, 5, 6, 7] },
  { id: "kanto", label: "関東", prefectures: [8, 9, 10, 11, 12, 13, 14] },
  { id: "chubu", label: "中部", prefectures: [15, 16, 17, 18, 19, 20, 21, 22, 23] },
  { id: "kinki", label: "近畿", prefectures: [24, 25, 26, 27, 28, 29, 30] },
  { id: "chugoku", label: "中国・四国", prefectures: [31, 32, 33, 34, 35, 36, 37, 38, 39] },
  { id: "kyushu", label: "九州・沖縄", prefectures: [40, 41, 42, 43, 44, 45, 46, 47] },
];

export type MuniEntry = { prefCode: number; prefecture: string; name: string };

/**
 * 市町村コード表を、都道府県つきの一覧で読む。政令市の区（「大阪市　北区」）は市に畳む（天気は市単位で足りるため）。
 * 並びは表の順（コード順）で、同じ都道府県の同名は1件にする。
 */
export function parseMuniEntries(text: string): MuniEntry[] {
  const line = /MUNI_ARRAY\["\d+"\]\s*=\s*'(\d+),([^,]*),[^,]*,([^']+)'/g;
  const seen = new Set<string>();
  const entries: MuniEntry[] = [];
  for (const match of text.matchAll(line)) {
    const prefCode = Number(match[1]);
    const name = match[3].split(/[\s　]+/)[0]?.trim() ?? "";
    if (!name || !Number.isInteger(prefCode)) continue;
    const key = `${prefCode}:${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ prefCode, prefecture: match[2].trim(), name });
  }
  return entries;
}

export function areaById(id: string | undefined): Area | null {
  return AREAS.find((area) => area.id === id) ?? null;
}

/** エリアに属する都道府県（コード順）。名前は一覧から拾う。 */
export function prefecturesOf(area: Area, entries: readonly MuniEntry[]): { code: number; name: string }[] {
  const names = new Map<number, string>();
  for (const entry of entries) if (!names.has(entry.prefCode)) names.set(entry.prefCode, entry.prefecture);
  return area.prefectures.flatMap((code) => {
    const name = names.get(code);
    return name ? [{ code, name }] : [];
  });
}

export function municipalitiesOf(prefCode: number, entries: readonly MuniEntry[]): MuniEntry[] {
  return entries.filter((entry) => entry.prefCode === prefCode);
}

/** `?area=&pref=` のURL。値は検証してから使う。 */
export function areaHref(params: { area?: string; pref?: number; city?: string }): string {
  const query = new URLSearchParams({ picker: "1" });
  if (params.area) query.set("area", params.area);
  if (params.pref) query.set("pref", String(params.pref));
  if (params.city) query.set("city", params.city);
  return `/weather?${query.toString()}`;
}

/** 登録済みの地点を都道府県つきにしたもの（#1096）。`name` は逆ジオコーダの市町村名（政令市は区まで）。 */
export type RegisteredSpot = { prefCode: number; name: string };

/** 都道府県ごとの登録済み件数。 */
export function registeredByPref(spots: readonly RegisteredSpot[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const spot of spots) counts.set(spot.prefCode, (counts.get(spot.prefCode) ?? 0) + 1);
  return counts;
}

/** エリアの登録済み件数（配下の都道府県の合計）。 */
export function registeredInArea(area: Area, counts: ReadonlyMap<number, number>): number {
  return area.prefectures.reduce((sum, code) => sum + (counts.get(code) ?? 0), 0);
}

/** 市町村が登録済みか。政令市は区の名前（「大阪市北区」）で入るので前方一致で見る。 */
export function isRegisteredMunicipality(entry: MuniEntry, spots: readonly RegisteredSpot[]): boolean {
  return spots.some((spot) => spot.prefCode === entry.prefCode && (spot.name === entry.name || spot.name.startsWith(entry.name)));
}
