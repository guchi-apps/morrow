/**
 * 雨雲レーダー（#654）の計算。気象庁の高解像度降水ナウキャストのタイルと地理院タイルを、現在地を中心に並べるための純粋関数。
 *
 * - **時刻の一覧もタイルもブラウザから直接取る。** どちらもキー不要で、一覧はCORSが開いている。サーバー経由にすると
 *   middlewareがタイル1枚ごとにSupabaseへ往復する（`rain-radar.tsx` の注記）
 * - 気象庁のこのURLは公開仕様ではない（気象庁サイト自身が使う経路）。形が変わると `parseTargetTimes()` が空を返し、画面は「取得できませんでした」になる
 * - 一覧の時刻はUTC。画面に出すときは `frameDate()` で読む
 */

const JMA_NOWC = "https://www.jma.go.jp/bosai/jmatile/data/nowc";
export const RADAR_PAST_TIMES_URL = `${JMA_NOWC}/targetTimes_N1.json`;
export const RADAR_FORECAST_TIMES_URL = `${JMA_NOWC}/targetTimes_N2.json`;
/** 降水短時間予報（#666）。ナウキャストの先（1時間より後。1時間刻みで約15時間先まで）を継ぎ足す。 */
const JMA_RASRF = "https://www.jma.go.jp/bosai/jmatile/data/rasrf";
export const RADAR_LONG_TIMES_URL = `${JMA_RASRF}/targetTimes.json`;

/** 周辺（約45km四方）と広域（約180km四方）のタイルのズーム。 */
export const RADAR_ZOOMS = { near: 10, wide: 8 } as const;
export type RadarZoom = (typeof RADAR_ZOOMS)[keyof typeof RADAR_ZOOMS];

const TILE_PX = 256;
/** 「今」の前後に出すコマ数（5分刻みで1時間ぶん）。 */
const FRAMES_EACH_SIDE = 12;

/** `member` があれば降水短時間予報（タイルのURLに入る）。無ければナウキャスト。 */
export type RadarTime = { basetime: string; validtime: string; member?: string };
export type RadarFrame = RadarTime & { kind: "past" | "now" | "forecast" };
export type RadarTile = { x: number; y: number; left: number; top: number };

/** 一覧のJSONを読む。降水の要素を持つ行だけ採り、知らない形は捨てる。 */
export function parseTargetTimes(json: unknown): RadarTime[] {
  if (!Array.isArray(json)) return [];
  const times: RadarTime[] = [];
  for (const row of json) {
    if (typeof row !== "object" || row === null) continue;
    const { basetime, validtime, elements } = row as Record<string, unknown>;
    if (typeof basetime !== "string" || !/^\d{14}$/.test(basetime)) continue;
    if (typeof validtime !== "string" || !/^\d{14}$/.test(validtime)) continue;
    if (!Array.isArray(elements) || !elements.includes("hrpns")) continue;
    times.push({ basetime, validtime });
  }
  return times;
}

/**
 * 降水短時間予報の一覧を読む。一覧には予報以外（解析値・他の製品）も混ざるので、降水（`rasrf`）の予報
 * （`validtime` が `basetime` より後）だけを採り、同じ時刻は新しい基準時刻の行を使う。
 */
export function parseLongRangeTimes(json: unknown): RadarTime[] {
  if (!Array.isArray(json)) return [];
  const byValid = new Map<string, RadarTime>();
  for (const row of json) {
    if (typeof row !== "object" || row === null) continue;
    const { basetime, validtime, member, elements } = row as Record<string, unknown>;
    if (typeof basetime !== "string" || !/^\d{14}$/.test(basetime)) continue;
    if (typeof validtime !== "string" || !/^\d{14}$/.test(validtime) || validtime <= basetime) continue;
    if (typeof member !== "string" || !/^[a-z]+$/.test(member)) continue;
    if (!Array.isArray(elements) || !elements.includes("rasrf")) continue;
    const known = byValid.get(validtime);
    if (!known || known.basetime < basetime) byValid.set(validtime, { basetime, validtime, member });
  }
  return [...byValid.values()];
}

/** 「今」の何時間後か（四捨五入）。スライダー右端の注記に使う。 */
export function hoursAfter(from: RadarTime, to: RadarTime): number {
  return Math.round((frameDate(to.validtime).getTime() - frameDate(from.validtime).getTime()) / 3_600_000);
}

/**
 * 実況の最新を「今」として、前後1時間のコマを古い順に並べる。実況と予報は更新の時刻がずれるので、
 * 「今」より後の予報だけを採る（同じ時刻を二重に出さない）。実況が無ければ空。
 */
export function buildFrames(past: RadarTime[], forecast: RadarTime[], longRange: RadarTime[] = []): RadarFrame[] {
  const observed = [...past].sort((a, b) => a.validtime.localeCompare(b.validtime));
  const latest = observed.at(-1);
  if (!latest) return [];
  const before = observed.slice(0, -1).slice(-FRAMES_EACH_SIDE);
  const after = forecast
    .filter((time) => time.validtime > latest.validtime)
    .sort((a, b) => a.validtime.localeCompare(b.validtime))
    .slice(0, FRAMES_EACH_SIDE);
  // ナウキャストが終わった後の時刻だけを降水短時間予報で継ぎ足す（同じ時刻を二重に出さない）
  const nowcastEnd = after.at(-1)?.validtime ?? latest.validtime;
  const beyond = longRange.filter((time) => time.validtime > nowcastEnd).sort((a, b) => a.validtime.localeCompare(b.validtime));
  return [
    ...before.map((time) => ({ ...time, kind: "past" as const })),
    { ...latest, kind: "now" as const },
    ...after.map((time) => ({ ...time, kind: "forecast" as const })),
    ...beyond.map((time) => ({ ...time, kind: "forecast" as const })),
  ];
}

/** 一覧の時刻（UTCのYYYYMMDDhhmmss）をDateにする。 */
export function frameDate(validtime: string): Date {
  const part = (start: number, end: number) => Number(validtime.slice(start, end));
  return new Date(Date.UTC(part(0, 4), part(4, 6) - 1, part(6, 8), part(8, 10), part(10, 12), part(12, 14)));
}

/** 気象庁のレーダーが届く範囲。外（海外）では地図を出さず案内する。 */
export function isInRadarArea(latitude: number, longitude: number): boolean {
  return latitude >= 20 && latitude <= 50 && longitude >= 118 && longitude <= 150;
}

/** 枠（幅×高さpx）の中心に地点を置いたとき、枠に掛かるタイルと、枠の左上からの位置を返す。 */
export function tilesFor(latitude: number, longitude: number, zoom: number, width: number, height: number): RadarTile[] {
  if (width <= 0 || height <= 0) return [];
  const world = 2 ** zoom * TILE_PX;
  const sinLat = Math.sin((latitude * Math.PI) / 180);
  const centerX = ((longitude + 180) / 360) * world;
  const centerY = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * world;
  // 端数のままだとタイルの継ぎ目に線が出るので、枠の位置を整数に揃える。
  const viewLeft = Math.round(centerX - width / 2);
  const viewTop = Math.round(centerY - height / 2);
  const tiles: RadarTile[] = [];
  for (let y = Math.floor(viewTop / TILE_PX); y <= Math.floor((viewTop + height - 1) / TILE_PX); y++) {
    for (let x = Math.floor(viewLeft / TILE_PX); x <= Math.floor((viewLeft + width - 1) / TILE_PX); x++) {
      tiles.push({ x, y, left: x * TILE_PX - viewLeft, top: y * TILE_PX - viewTop });
    }
  }
  return tiles;
}

export function baseTileUrl(zoom: number, tile: Pick<RadarTile, "x" | "y">): string {
  return `https://cyberjapandata.gsi.go.jp/xyz/pale/${zoom}/${tile.x}/${tile.y}.png`;
}

export function rainTileUrl(frame: RadarTime, zoom: number, tile: Pick<RadarTile, "x" | "y">): string {
  if (frame.member) return `${JMA_RASRF}/${frame.basetime}/${frame.member}/${frame.validtime}/surf/rasrf/${zoom}/${tile.x}/${tile.y}.png`;
  return `${JMA_NOWC}/${frame.basetime}/none/${frame.validtime}/surf/hrpns/${zoom}/${tile.x}/${tile.y}.png`;
}

/** 取り直した一覧の中で、見ていたコマの位置を引き継ぐ。「今」を見ていた・無くなったコマなら新しい「今」へ。 */
export function carryFrameIndex(previous: RadarFrame | undefined, frames: RadarFrame[]): number {
  const nowIndex = frames.findIndex((frame) => frame.kind === "now");
  if (!previous || previous.kind === "now") return nowIndex;
  const same = frames.findIndex((frame) => frame.validtime === previous.validtime);
  return same === -1 ? nowIndex : same;
}
