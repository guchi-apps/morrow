/**
 * 時間と場所ごとの天気・行き先の雨（#586）の、DBにもネットワークにも触れない部分。
 *
 * - 予定（`aide_schedule` の応答）から「どこに・いつ居るか」の区間を作る（`buildStays()`）
 * - 国土地理院の住所検索・市町村コード表、Open-Meteoの予報を読む
 * - 区間の時間帯の天気をまとめ、雨かどうかを決める
 *
 * **地名の解決は推定。** 「栗東」のような短い地名は、候補のうち「◯◯市/町/村」に一致するものだけを採り、
 * 市町村に当たらない語（「本社」「オンライン」）は解決しない（`null`）。見当違いの地点の天気を出すより、
 * 「分からない」と出す方へ倒してある。`test/rain-check.test.ts` が固定する。
 */

/* ---------------- 予定 → 区間 ---------------- */

/** 1日の中で、ある場所に居る時間帯。`start`/`end` は `HH:MM`（`end` の `24:00` は日の終わり）。 */
export type Stay = {
  date: string;
  start: string;
  end: string;
  /** 予定に書かれた地名そのもの（「栗東」「自宅 大阪府高槻市…」）。 */
  placeText: string;
  home: boolean;
  /** 区間の手掛かりになった予定のタイトル（移動先に居る間の予定など）。無ければnull。 */
  label: string | null;
  /** 終日の予定から作った区間（時刻の表示を「終日」にする）。 */
  allDay: boolean;
};

export type StayDay = { date: string; stays: Stay[] };

const DAY_START = "00:00";
const DAY_END = "24:00";
/** 終日の予定・行き先に居る終わりが分からないときの時間帯（`aide_schedule` の `freeWindow` の既定と同じ）。 */
const ALL_DAY_FROM = "08:00";
const ALL_DAY_TO = "22:00";

const TIME = /^\d{2}:\d{2}$/;
const HOME_PREFIX = "自宅";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record).filter((item): item is Record<string, unknown> => item !== null) : [];
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function time(value: unknown): string | null {
  const text = str(value);
  return text && TIME.test(text) ? text : null;
}

export function isHomePlace(text: string): boolean {
  return text.startsWith(HOME_PREFIX);
}

type Travel = { origin: string | null; destination: string | null; start: string; end: string; title: string | null };

/** 移動の行き先。`destination` が無い応答では、タイトルの `→` の右側を使う。 */
function travelsOf(day: Record<string, unknown>): Travel[] {
  const travels: Travel[] = [];
  for (const travel of list(day.travels)) {
    const start = time(travel.startTime);
    const end = time(travel.endTime);
    if (!start || !end) continue;
    const title = str(travel.title);
    const [fromTitle, toTitle] = title?.includes("→") ? title.split("→").map((part) => part.trim()) : [null, null];
    travels.push({
      origin: str(travel.origin) ?? (fromTitle || null),
      destination: str(travel.destination) ?? (toTitle || null),
      start,
      end,
      title,
    });
  }
  return travels.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

/** 時間帯が重なる、場所の書かれていない予定のタイトル（行き先で何をするか）。 */
function labelFor(events: Record<string, unknown>[], start: string, end: string): string | null {
  for (const event of events) {
    if (event.allDay === true || str(event.location)) continue;
    const from = time(event.startTime);
    const to = time(event.endTime);
    if (!from || !to) continue;
    if (from < end && to > start) return str(event.title);
  }
  return null;
}

function cancelled(event: Record<string, unknown>): boolean {
  return event.outcome === "CANCELED" || event.outcome === "ABSENT";
}

/**
 * 1日ぶんの区間を作る。
 *
 * - 移動があれば「最初の出発まで（出発地）→ 着いてから次に出るまで（行き先）→ …」。最後の行き先は日の終わりまで
 *   （自宅以外なら22:00まで）
 * - 場所欄のある予定は、その開始〜終了（終日なら8:00〜22:00）を行き先の区間として足す
 * - **`withHome` が真で、移動も場所欄も無い日は、自宅の1区間（終日）だけ**を返す
 * - 場所欄が空の予定は、移動中・他の区間と重ならなければ自宅の区間として足す（#597。ラベルは予定のタイトル）
 * - `withHome` が偽（明日以降）は、移動から作った自宅の区間（出発前・帰宅後）を出さない
 *
 * 中止・不参加の予定は使わない。
 */
export function staysForDay(day: Record<string, unknown>, withHome: boolean): Stay[] {
  const date = str(day.date) ?? "";
  const events = list(day.events).filter((event) => !cancelled(event));
  const travels = travelsOf(day);
  const stays: Stay[] = [];

  const push = (stay: Omit<Stay, "date" | "home">) => {
    if (stay.start >= stay.end) return;
    stays.push({ date, home: isHomePlace(stay.placeText), ...stay });
  };

  if (travels.length > 0) {
    const first = travels[0];
    const origin = first.origin ?? HOME_PREFIX;
    push({ start: DAY_START, end: first.start, placeText: origin, label: null, allDay: false });

    travels.forEach((travel, index) => {
      if (!travel.destination) return;
      const next = travels[index + 1];
      const home = isHomePlace(travel.destination);
      const end = next?.start ?? (home ? DAY_END : ALL_DAY_TO);
      push({
        start: travel.end,
        end,
        placeText: travel.destination,
        label: home ? null : labelFor(events, travel.end, end),
        allDay: false,
      });
    });
  }

  for (const event of events) {
    const location = str(event.location);
    if (!location) continue;
    const allDay = event.allDay === true;
    const start = allDay ? ALL_DAY_FROM : time(event.startTime);
    const end = allDay ? ALL_DAY_TO : time(event.endTime);
    if (!start || !end) continue;
    push({ start, end, placeText: location, label: str(event.title), allDay });
  }

  if (withHome && stays.length === 0) {
    return [{ date, start: DAY_START, end: DAY_END, placeText: HOME_PREFIX, home: true, label: null, allDay: true }];
  }
  const kept = withHome ? stays : stays.filter((stay) => !stay.home);

  // 場所欄が空の予定は自宅に居るものとして足す（#597）。移動中・他の区間と重なる予定は足さない
  // （行き先に居る間の予定はラベルに使い済み。移動前の自宅区間に重なる「睡眠」なども二重に出さない）。
  const blockers: { start: string; end: string }[] = [...kept, ...travels];
  const homeEvents: Stay[] = [];
  const locationless = events
    .filter((event) => !str(event.location))
    .map((event) => {
      const allDay = event.allDay === true;
      return {
        start: allDay ? ALL_DAY_FROM : time(event.startTime),
        end: allDay ? ALL_DAY_TO : time(event.endTime),
        label: str(event.title),
        allDay,
      };
    })
    .filter((item): item is { start: string; end: string; label: string | null; allDay: boolean } =>
      Boolean(item.start && item.end && item.start < item.end),
    )
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  for (const item of locationless) {
    if (blockers.some((other) => item.start < other.end && item.end > other.start)) continue;
    const stay: Stay = { date, placeText: HOME_PREFIX, home: true, ...item };
    homeEvents.push(stay);
    blockers.push(stay);
  }

  return [...kept, ...homeEvents].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

/**
 * `aide_schedule` の応答から、日ごとの区間を作る。**1日目（今日）だけ自宅の区間を含める**
 * （明日以降は行き先の雨だけを見せる）。日付は各日の `date` を使う。形が読めなければnull。
 */
export function buildStays(json: unknown): StayDay[] | null {
  const root = record(json);
  if (!root || root.configured === false) return null;
  const days = list(root.days);
  if (days.length === 0) return null;
  return days.map((day, index) => ({ date: str(day.date) ?? "", stays: staysForDay(day, index === 0) }));
}

/**
 * 明日（2日目）の区間を**自宅込みで**作る（#594）。1時間ごとの帯で、明日にかかる時間の場所を決めるためだけに使う
 * （「明日以降の行き先の雨」は `buildStays()` の行き先だけのまま）。2日目が無ければ空。
 */
export function tomorrowStaysWithHome(json: unknown): Stay[] {
  const day = list(record(json)?.days)[1];
  return day ? staysForDay(day, true) : [];
}

/* ---------------- 1時間ごとの場所（#594） ---------------- */

/**
 * ある時間（`hour` 時台）に居る場所。
 * - `stay`: 区間 `stays[index]` の中
 * - `move`: どの区間にも当たらず、前後の区間に挟まれている（移動中。次の区間 `stays[index]` の予報を使う）
 * - `home`: どの区間にも当たらず、最初の区間より前か最後の区間より後（日の終わり・翌朝）。自宅で埋める
 */
export type HourPlace = { kind: "stay" | "move"; index: number } | { kind: "home" };

function hourLabel(hour: number, minute: string): string {
  return `${String(hour).padStart(2, "0")}:${minute}`;
}

/**
 * `hour` 時台の**30分の時点**に居る区間を選ぶ。区間が重なるときは後に始まる区間（より具体的な予定。
 * 移動の行き先の中に足された場所欄のある予定など）を優先する。`stays` は1日ぶん。
 */
export function placeAtHour(stays: Stay[], hour: number): HourPlace {
  const mid = hourLabel(hour, "30");
  let found = -1;
  stays.forEach((stay, index) => {
    if (stay.start <= mid && mid < stay.end && (found < 0 || stay.start >= stays[found].start)) found = index;
  });
  if (found >= 0) return { kind: "stay", index: found };

  // 区間と区間の間だけを移動とみなす。最初の区間より前・最後の区間より後は自宅に居るものとする。
  const after = stays.some((stay) => stay.end <= mid);
  let next = -1;
  stays.forEach((stay, index) => {
    if (stay.start > mid && (next < 0 || stay.start < stays[next].start)) next = index;
  });
  return after && next >= 0 ? { kind: "move", index: next } : { kind: "home" };
}

/** 帯に出す時間の数。開いた時刻によらず、いまの時間から24時間ぶん（23時に開けば翌22時まで。#599）。 */
export const HOURLY_SPAN = 24;

/**
 * 今日・明日の0〜24時の行から、いま（`nowDate` の `nowHour` 時台）以降の `span` 時間を切り出す。
 * 行は日付・時の順に並んでいる前提。キャッシュした行を描画のたびに切り出すため、ここは `now` だけで決まる。
 */
export function hoursFrom<T extends { date: string; hour: number }>(
  rows: T[],
  nowDate: string,
  nowHour: number,
  span = HOURLY_SPAN,
): T[] {
  const start = rows.findIndex((row) => row.date > nowDate || (row.date === nowDate && row.hour >= nowHour));
  if (start < 0) return [];
  return rows.slice(start, start + span);
}

/**
 * 今日の0時から、いま（`nowDate` の `nowHour` 時台）の `span` 時間先までを切り出す（#609。過ぎた時間も含む）。
 * 行は日付・時の順に並び、先頭が今日の0時である前提。いまが行に無ければ空。
 */
export function hoursSinceMidnight<T extends { date: string; hour: number }>(
  rows: T[],
  nowDate: string,
  nowHour: number,
  span = HOURLY_SPAN,
): T[] {
  const now = rows.findIndex((row) => row.date === nowDate && row.hour === nowHour);
  if (now < 0) return [];
  const first = rows.findIndex((row) => row.date === nowDate);
  return rows.slice(first, now + span);
}

/** 予報の、ある日のある時（毎正時）の点。無ければnull。 */
export function hourlyPoint(forecast: Forecast, date: string, hour: number): HourlyPoint | null {
  const key = `${date}T${hourLabel(hour, "00")}`;
  return forecast.hourly.find((point) => point.time === key) ?? null;
}

/* ---------------- 地名 ---------------- */

export type Coordinates = { latitude: number; longitude: number };
export type ResolvedPlace = Coordinates & { name: string };

export type GsiCandidate = Coordinates & { title: string };

/** 国土地理院の住所検索（`AddressSearch`）の応答を読む。形の違う要素は落とす。 */
export function parseGsiSearch(json: unknown): GsiCandidate[] {
  if (!Array.isArray(json)) return [];
  const candidates: GsiCandidate[] = [];
  for (const item of json) {
    const feature = record(item);
    const coordinates = record(feature?.geometry)?.coordinates;
    const title = str(record(feature?.properties)?.title);
    if (!title || !Array.isArray(coordinates)) continue;
    const [longitude, latitude] = coordinates;
    if (typeof latitude !== "number" || typeof longitude !== "number") continue;
    candidates.push({ title, latitude, longitude });
  }
  return candidates;
}

const PREFECTURE = /^(東京都|北海道|(?:京都|大阪)府|.{2,3}県)/;
const MUNICIPALITY_SUFFIX = /[市町村区]$/;

/** 「滋賀県栗東市」→「栗東市」。都道府県の付かない題は付いたまま返す。 */
function withoutPrefecture(title: string): string {
  return title.replace(PREFECTURE, "");
}

/** 2点間のおおよその距離（km）。近い候補を選ぶためだけに使う。 */
export function distanceKm(a: Coordinates, b: Coordinates): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * 予定に書かれた地名を、住所検索の候補から1つの市町村に決める。
 *
 * 1. 候補の題が「都道府県＋（地名）市/町/村/区」に一致するもの（「栗東」→「滋賀県栗東市」）
 * 2. 地名そのものに市・町・村・区が入っている（住所が書かれている）なら、先頭の候補の地点
 *    （名前は呼び出し側が逆ジオコーダで引く。`name` は空で返す）
 *
 * どちらにも当たらなければnull（「本社」→「静岡県沼津市本」のような見当違いを採らない）。
 * 候補が複数あれば、`near`（自宅）にいちばん近いものを選ぶ（「草津」→ 群馬ではなく滋賀）。
 */
export function pickMunicipality(
  text: string,
  candidates: GsiCandidate[],
  near: Coordinates | null,
): ResolvedPlace | null {
  const query = text.trim();
  const closest = <T extends Coordinates>(items: T[]): T =>
    near ? items.reduce((best, item) => (distanceKm(near, item) < distanceKm(near, best) ? item : best)) : items[0];

  const exact = candidates.filter((candidate) => {
    const muni = withoutPrefecture(candidate.title);
    return muni !== candidate.title && MUNICIPALITY_SUFFIX.test(muni) && muni.startsWith(query) && muni.length <= query.length + 1;
  });
  if (exact.length > 0) {
    const chosen = closest(exact);
    return { name: withoutPrefecture(chosen.title), latitude: chosen.latitude, longitude: chosen.longitude };
  }

  if (/[市町村区]/.test(query) && candidates.length > 0) {
    const first = candidates[0];
    return { name: "", latitude: first.latitude, longitude: first.longitude };
  }
  return null;
}

/** 予定の地名から、検索に使う部分を取り出す（「自宅 大阪府高槻市…」→「大阪府高槻市…」）。 */
export function searchTextOf(placeText: string): string {
  return placeText.replace(new RegExp(`^${HOME_PREFIX}\\s*`), "").trim();
}

/** 文中のどこにあっても都道府県名と分かるよう、名前を並べて持つ（`PREFECTURE` の `.{2,3}県` は先頭でしか使えない）。 */
const PREFECTURE_ANYWHERE = new RegExp(
  `(${[
    "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県",
    "東京都", "神奈川県", "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県", "三重県",
    "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県",
    "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
  ].join("|")})`,
);

/**
 * 住所検索へ渡す文字列（#597）。場所欄は「店名 住所」の形が多く、丸ごと渡すと0件になるので、
 * 都道府県名を含めばそこから後ろ（住所）だけにする。含まなければ従来どおり丸ごと。
 *
 * 都道府県の無い場所欄で「市・町・村・区を含む語」から切り出すことはしない——「区役所前」「町田」のような語で
 * 見当違いの地点を拾いうる（`pickMunicipality()` は `市町村区` の1文字でも先頭の候補を採る）。
 */
export function addressQueryOf(placeText: string): string {
  const text = searchTextOf(placeText);
  const prefecture = text.search(PREFECTURE_ANYWHERE);
  return prefecture > 0 ? text.slice(prefecture).trim() : text;
}

/**
 * 地理院地図の市町村コード表（`muni.js`）を読む。
 * 鍵は先頭の0を落とした数値の文字列で、政令市の区は「大阪市　北区」と全角空白で区切られている。
 */
export function parseMuniTable(text: string): Map<string, string> {
  const table = new Map<string, string>();
  const line = /MUNI_ARRAY\["(\d+)"\]\s*=\s*'[^,]*,[^,]*,[^,]*,([^']+)'/g;
  for (const match of text.matchAll(line)) {
    table.set(String(Number(match[1])), match[2].replace(/[\s　]+/g, ""));
  }
  return table;
}

/** 逆ジオコーダ（`LonLatToAddress`）の応答から市町村名を引く。海上など当たらなければnull。 */
export function municipalityFromReverse(json: unknown, table: Map<string, string>): string | null {
  const code = str(record(record(json)?.results)?.muniCd);
  if (!code || !/^\d+$/.test(code)) return null;
  return table.get(String(Number(code))) ?? null;
}

/* ---------------- 予報 ---------------- */

export type HourlyPoint = {
  time: string;
  code: number | null;
  temperature: number | null;
  pop: number | null;
  /** 1時間の降水量（mm）。 */
  precipitation: number | null;
};
export type DailyPoint = { date: string; code: number | null; max: number | null; min: number | null; pop: number | null };
export type Forecast = { hourly: HourlyPoint[]; daily: DailyPoint[] };

function numbers(value: unknown): (number | null)[] {
  return Array.isArray(value) ? value.map((item) => (typeof item === "number" && Number.isFinite(item) ? item : null)) : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => (typeof item === "string" ? item : "")) : [];
}

/** Open-Meteoの `forecast` の応答を読む。時刻が無ければnull（失敗として扱う）。 */
export function parseOpenMeteo(json: unknown): Forecast | null {
  const root = record(json);
  const hourly = record(root?.hourly);
  const daily = record(root?.daily);
  const hourTimes = strings(hourly?.time);
  if (hourTimes.length === 0) return null;

  const codes = numbers(hourly?.weather_code);
  const temps = numbers(hourly?.temperature_2m);
  const pops = numbers(hourly?.precipitation_probability);
  const rains = numbers(hourly?.precipitation);
  const dayTimes = strings(daily?.time);
  const dayCodes = numbers(daily?.weather_code);
  const maxes = numbers(daily?.temperature_2m_max);
  const mins = numbers(daily?.temperature_2m_min);
  const dayPops = numbers(daily?.precipitation_probability_max);

  return {
    hourly: hourTimes.map((time, i) => ({ time, code: codes[i] ?? null, temperature: temps[i] ?? null, pop: pops[i] ?? null, precipitation: rains[i] ?? null })),
    daily: dayTimes.map((date, i) => ({ date, code: dayCodes[i] ?? null, max: maxes[i] ?? null, min: mins[i] ?? null, pop: dayPops[i] ?? null })),
  };
}

/** 天気コードの訳語。**AIDEの `describeWeatherCode()`（`aide_weather` の `summary`）と同じ表**にして、自宅と行き先で表現を揃える。 */
const WEATHER_CODE_TEXT = new Map<number, string>([
  [0, "快晴"],
  [1, "おおむね晴れ"],
  [2, "晴れ時々くもり"],
  [3, "くもり"],
  [45, "霧"],
  [48, "霧（霧氷）"],
  [51, "霧雨（弱）"],
  [53, "霧雨"],
  [55, "霧雨（強）"],
  [56, "着氷性の霧雨（弱）"],
  [57, "着氷性の霧雨（強）"],
  [61, "雨（弱）"],
  [63, "雨"],
  [65, "雨（強）"],
  [66, "着氷性の雨（弱）"],
  [67, "着氷性の雨（強）"],
  [71, "雪（弱）"],
  [73, "雪"],
  [75, "雪（強）"],
  [77, "霧雪"],
  [80, "にわか雨（弱）"],
  [81, "にわか雨"],
  [82, "にわか雨（激しい）"],
  [85, "にわか雪（弱）"],
  [86, "にわか雪（強）"],
  [95, "雷雨"],
  [96, "雷雨（ひょうをともなう）"],
  [99, "雷雨（激しいひょうをともなう）"],
]);

export function describeWeatherCode(code: number | null): string {
  if (code === null) return "不明";
  return WEATHER_CODE_TEXT.get(code) ?? `天気コード ${code}`;
}

export type WindowWeather = {
  summary: string;
  min: number | null;
  max: number | null;
  pop: number | null;
  /** 区間の中で最初に雨（50%以上）になる時（0〜23）。無ければnull（#594）。 */
  rainFrom: number | null;
};

function hourOf(hhmm: string): number {
  return Number(hhmm.slice(0, 2));
}

/**
 * ある日の `start`〜`end` に掛かる時間（毎正時）の天気をまとめる。
 * 天気はいちばん荒れたコード（WMOの表は数が大きいほど降水・雷に寄る）、降水確率は最大、気温は最低〜最高。
 * 当たる時間が1つも無ければnull（予報の範囲外）。
 */
export function summarizeWindow(forecast: Forecast, date: string, start: string, end: string): WindowWeather | null {
  const from = hourOf(start);
  const to = end === DAY_END ? 24 : Math.max(from + 1, Math.ceil(hourOf(end) + Number(end.slice(3)) / 60));
  const hours = forecast.hourly.filter((point) => {
    if (!point.time.startsWith(`${date}T`)) return false;
    const hour = Number(point.time.slice(11, 13));
    return hour >= from && hour < to;
  });
  if (hours.length === 0) return null;

  const codes = hours.map((h) => h.code).filter((c): c is number => c !== null);
  const temps = hours.map((h) => h.temperature).filter((t): t is number => t !== null);
  const pops = hours.map((h) => h.pop).filter((p): p is number => p !== null);
  const rainy = hours.find((h) => h.pop !== null && h.pop >= RAIN_POP);
  return {
    summary: describeWeatherCode(codes.length > 0 ? Math.max(...codes) : null),
    min: temps.length > 0 ? Math.min(...temps) : null,
    max: temps.length > 0 ? Math.max(...temps) : null,
    pop: pops.length > 0 ? Math.max(...pops) : null,
    rainFrom: rainy ? Number(rainy.time.slice(11, 13)) : null,
  };
}

export type RainVerdict = "rain" | "maybe" | "dry" | "unknown";

/** 雨とみなす降水確率（%）。ダッシュボードの「傘が要りそうです」（`RAIN_POP`）と同じ。 */
export const RAIN_POP = 50;
export const MAYBE_POP = 30;

export function rainVerdict(pop: number | null): RainVerdict {
  if (pop === null) return "unknown";
  if (pop >= RAIN_POP) return "rain";
  if (pop >= MAYBE_POP) return "maybe";
  return "dry";
}

export type NextHours = { pop: number | null; rainFrom: string | null };

/**
 * `now`（`YYYY-MM-DDTHH:00` の毎正時。日本時間）から3時間の降水確率の最大と、雨（50%以上）になる最初の時刻。
 */
export function nextHours(forecast: Forecast, nowHour: string, hours = 3): NextHours {
  const index = forecast.hourly.findIndex((point) => point.time >= nowHour);
  if (index < 0) return { pop: null, rainFrom: null };
  const slice = forecast.hourly.slice(index, index + hours);
  const pops = slice.map((p) => p.pop).filter((p): p is number => p !== null);
  const rainy = slice.find((p) => p.pop !== null && p.pop >= RAIN_POP);
  return { pop: pops.length > 0 ? Math.max(...pops) : null, rainFrom: rainy ? rainy.time.slice(11, 16) : null };
}

/** 位置を丸める（小数2桁≒1km）。外部サービスへ送る値・キャッシュの鍵に使う。 */
export function roundCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

export function isValidCoordinates(latitude: unknown, longitude: unknown): latitude is number {
  return (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  );
}
