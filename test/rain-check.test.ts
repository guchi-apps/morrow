/**
 * 時間と場所ごとの天気・行き先の雨（#586）の、予定の読み替え・地名の選び方・予報のまとめ方。
 *
 * 予定の形は2026-10-20に本番のAIDEから取った `aide_schedule`（`days: 3`）の実物に、地名の候補は同日の
 * 国土地理院の住所検索の応答に合わせてある。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addressQueryOf,
  buildStays,
  municipalityFromReverse,
  nextHours,
  parseGsiSearch,
  parseMuniTable,
  parseOpenMeteo,
  pickMunicipality,
  rainVerdict,
  searchTextOf,
  summarizeWindow,
  hourlyPoint,
  hoursFrom,
  mergeOverlappingStays,
  hoursSinceMidnight,
  placeAtHour,
  tomorrowStaysWithHome,
} from "../src/lib/weather/rain-check.ts";

const HOME_ADDRESS = "自宅 大阪府高槻市出丸町3-36";

const SCHEDULE = {
  configured: true,
  complete: true,
  days: [
    {
      date: "2026-10-20",
      events: [
        { title: "睡眠", allDay: false, startTime: "00:03", endTime: "05:57", location: null, outcome: null },
        { title: "勤務（栗東）", allDay: false, startTime: "07:30", endTime: "17:30", location: null, outcome: null },
        { title: "消防訓練", allDay: false, startTime: "17:30", endTime: "19:30", location: null, outcome: null },
      ],
      travels: [
        { title: "自宅 → 栗東", origin: HOME_ADDRESS, destination: "栗東", startTime: "06:30", endTime: "07:30" },
        { title: "栗東 → 自宅", origin: "栗東", destination: HOME_ADDRESS, startTime: "17:30", endTime: "18:30" },
      ],
    },
    {
      date: "2026-10-21",
      events: [
        { title: "飲み会", allDay: false, startTime: "19:00", endTime: "21:00", location: "京都駅", outcome: "CANCELED" },
        { title: "研修", allDay: true, startTime: null, endTime: null, location: "草津", outcome: null },
      ],
      travels: [],
    },
    {
      date: "2026-10-22",
      events: [{ title: "出張（門真）", allDay: false, startTime: "07:45", endTime: "17:15", location: null, outcome: null }],
      travels: [],
    },
  ],
};

describe("buildStays", () => {
  it("今日は移動から「自宅 → 行き先 → 自宅」の区間を作り、行き先に居る間の予定をラベルにする", () => {
    const days = buildStays(SCHEDULE);
    assert.ok(days);
    assert.deepEqual(
      days[0].stays.map((stay) => [stay.start, stay.end, stay.placeText, stay.home, stay.label]),
      [
        ["00:00", "06:30", HOME_ADDRESS, true, null],
        ["07:30", "17:30", "栗東", false, "勤務（栗東）"],
        ["18:30", "24:00", HOME_ADDRESS, true, null],
      ],
    );
    assert.equal(days[0].date, "2026-10-20");
  });

  it("明日以降は行き先だけ。中止の予定は使わず、終日の予定は8:00〜22:00", () => {
    const days = buildStays(SCHEDULE);
    assert.ok(days);
    assert.deepEqual(
      days[1].stays.map((stay) => [stay.date, stay.start, stay.end, stay.placeText, stay.allDay]),
      [["2026-10-21", "08:00", "22:00", "草津", true]],
    );
  });

  it("場所欄が空の予定は自宅の区間にする（タイトルの括弧は読まない。#597）", () => {
    const days = buildStays(SCHEDULE);
    assert.deepEqual(
      days?.[2].stays.map((stay) => [stay.start, stay.end, stay.placeText, stay.home, stay.label]),
      [["07:45", "17:15", "自宅", true, "出張（門真）"]],
    );
  });

  it("場所欄が空の予定でも、移動中・他の区間と重なるものは足さない", () => {
    const days = buildStays({
      configured: true,
      days: [
        {
          date: "2026-10-23",
          events: [
            { title: "睡眠", startTime: "00:10", endTime: "06:00", location: null },
            { title: "電話", startTime: "06:40", endTime: "07:00", location: null },
            { title: "散髪", startTime: "12:00", endTime: "14:00", location: "大阪府堺市北区百舌鳥梅町3丁11-1" },
            { title: "買い物", startTime: "13:00", endTime: "15:00", location: null },
            { title: "夕食", startTime: "18:00", endTime: "20:00", location: null },
            { title: "夕食の片付け", startTime: "19:30", endTime: "20:30", location: null },
          ],
          travels: [{ title: "自宅 → 栗東", origin: HOME_ADDRESS, destination: "栗東", startTime: "06:30", endTime: "07:30" }],
        },
      ],
    });
    // 今日（自宅込み）: 移動前の自宅区間に重なる「睡眠」・移動中の「電話」・行き先に重なる予定は足さない
    assert.deepEqual(
      days?.[0].stays.map((stay) => [stay.start, stay.end, stay.home, stay.label]),
      [
        ["00:00", "06:30", true, null],
        ["07:30", "22:00", false, "買い物"],
        ["12:00", "14:00", false, "散髪"],
      ],
    );
  });

  it("明日以降は、移動から作った自宅の区間を出さずに、場所欄が空の予定を自宅として足す", () => {
    const days = buildStays({
      configured: true,
      days: [
        { date: "2026-10-22", events: [], travels: [] },
        {
          date: "2026-10-23",
          events: [
            { title: "睡眠", startTime: "00:10", endTime: "06:00", location: null },
            { title: "夕食", startTime: "18:00", endTime: "20:00", location: null },
            { title: "休み", allDay: true, location: null, outcome: "CANCELED" },
          ],
          travels: [
            { title: "自宅 → 栗東", origin: HOME_ADDRESS, destination: "栗東", startTime: "06:30", endTime: "07:30" },
            { title: "栗東 → 自宅", origin: "栗東", destination: HOME_ADDRESS, startTime: "16:30", endTime: "17:30" },
          ],
        },
      ],
    });
    assert.deepEqual(
      days?.[1].stays.map((stay) => [stay.start, stay.end, stay.placeText, stay.home, stay.label]),
      [
        ["00:10", "06:00", "自宅", true, "睡眠"],
        ["07:30", "16:30", "栗東", false, null],
        ["18:00", "20:00", "自宅", true, "夕食"],
      ],
    );
  });

  it("今日に移動も場所欄も無ければ、自宅の1区間（終日）だけ", () => {
    const days = buildStays({ configured: true, days: [{ date: "2026-10-24", events: [], travels: [] }] });
    assert.deepEqual(
      days?.[0].stays.map((stay) => [stay.start, stay.end, stay.home, stay.allDay]),
      [["00:00", "24:00", true, true]],
    );
  });

  it("移動に destination が無い応答は、タイトルの → の右側を行き先にする", () => {
    const days = buildStays({
      configured: true,
      days: [{ date: "2026-10-19", travels: [{ title: "高槻市 → 大日", startTime: "06:42", endTime: "07:09" }] }],
    });
    assert.deepEqual(
      days?.[0].stays.map((stay) => [stay.start, stay.end, stay.placeText]),
      [
        ["00:00", "06:42", "高槻市"],
        ["07:09", "22:00", "大日"],
      ],
    );
  });

  it("未設定・形の読めない応答はnull", () => {
    assert.equal(buildStays({ configured: false }), null);
    assert.equal(buildStays({ configured: true, days: [] }), null);
    assert.equal(buildStays(null), null);
  });
});

describe("pickMunicipality", () => {
  const takatsuki = { latitude: 34.85, longitude: 135.62 };

  it("「◯◯市/町/村」に一致する候補だけを採る", () => {
    const candidates = parseGsiSearch([
      { geometry: { coordinates: [135.998062, 35.021667], type: "Point" }, properties: { title: "滋賀県栗東市" } },
      { geometry: { coordinates: [136.0067, 35.0221], type: "Point" }, properties: { title: "県立栗東高等学校" } },
    ]);
    assert.deepEqual(pickMunicipality("栗東", candidates, takatsuki), {
      name: "栗東市",
      latitude: 35.021667,
      longitude: 135.998062,
    });
  });

  it("同名が複数あれば自宅に近い方（草津 → 群馬ではなく滋賀）", () => {
    const candidates = parseGsiSearch([
      { geometry: { coordinates: [138.59, 36.62] }, properties: { title: "群馬県草津町" } },
      { geometry: { coordinates: [135.96, 35.01] }, properties: { title: "滋賀県草津市" } },
    ]);
    assert.equal(pickMunicipality("草津", candidates, takatsuki)?.name, "草津市");
    assert.equal(pickMunicipality("草津", candidates, null)?.name, "草津町");
  });

  it("市町村に当たらない語は解決しない（本社 → 静岡県沼津市本 を採らない）", () => {
    const candidates = parseGsiSearch([{ geometry: { coordinates: [138.86, 35.1] }, properties: { title: "静岡県沼津市本" } }]);
    assert.equal(pickMunicipality("本社", candidates, takatsuki), null);
    assert.equal(pickMunicipality("オンライン", [], takatsuki), null);
  });

  it("住所が書かれていれば先頭の候補の地点（名前は逆ジオコーダで引く）", () => {
    const candidates = parseGsiSearch([{ geometry: { coordinates: [135.61, 34.85] }, properties: { title: "大阪府高槻市出丸町" } }]);
    assert.deepEqual(pickMunicipality(searchTextOf(HOME_ADDRESS), candidates, null), {
      name: "",
      latitude: 34.85,
      longitude: 135.61,
    });
  });

  it("店名の後に住所が書かれていれば、都道府県から後ろを検索する（#597）", () => {
    assert.equal(
      addressQueryOf("リラクゼーション ヘアサロン Bean's 大阪府堺市北区百舌鳥梅町3丁11-1 タツミマンション102"),
      "大阪府堺市北区百舌鳥梅町3丁11-1 タツミマンション102",
    );
    assert.equal(addressQueryOf(HOME_ADDRESS), "大阪府高槻市出丸町3-36");
    // 都道府県が無ければ丸ごと（「区役所前」のような語から切り出して見当違いの地点を拾わない）
    assert.equal(addressQueryOf("カフェ 区役所前"), "カフェ 区役所前");
    assert.equal(addressQueryOf("栗東"), "栗東");
    assert.equal(addressQueryOf("自宅"), "");
  });

  it("形の違う候補は落とす", () => {
    assert.deepEqual(parseGsiSearch([{ properties: { title: "x" } }, { geometry: { coordinates: ["a", 1] }, properties: { title: "y" } }]), []);
    assert.deepEqual(parseGsiSearch({ error: true }), []);
  });
});

describe("市町村コード表", () => {
  const table = parseMuniTable(`
GSI.MUNI_ARRAY["27207"] = '27,大阪府,27207,高槻市';
GSI.MUNI_ARRAY["27127"] = '27,大阪府,27127,大阪市　北区';
GSI.MUNI_ARRAY["1101"] = '1,北海道,1101,札幌市　中央区';
`);

  it("逆ジオコーダのコードから名前を引く（先頭の0・区の全角空白を揃える）", () => {
    assert.equal(municipalityFromReverse({ results: { muniCd: "27207", lv01Nm: "高槻町" } }, table), "高槻市");
    assert.equal(municipalityFromReverse({ results: { muniCd: "27127" } }, table), "大阪市北区");
    assert.equal(municipalityFromReverse({ results: { muniCd: "01101" } }, table), "札幌市中央区");
  });

  it("海上など当たらない応答はnull", () => {
    assert.equal(municipalityFromReverse({}, table), null);
    assert.equal(municipalityFromReverse({ results: { muniCd: "99999" } }, table), null);
  });
});

describe("予報のまとめ", () => {
  const hours = Array.from({ length: 24 }, (_, hour) => hour);
  const forecast = parseOpenMeteo({
    hourly: {
      time: hours.map((hour) => `2026-10-20T${String(hour).padStart(2, "0")}:00`),
      weather_code: hours.map((hour) => (hour >= 10 && hour < 15 ? 63 : 3)),
      temperature_2m: hours.map((hour) => 15 + hour / 2),
      precipitation_probability: hours.map((hour) => (hour >= 10 && hour < 15 ? 80 : 20)),
    },
    daily: {
      time: ["2026-10-20"],
      weather_code: [63],
      temperature_2m_max: [26.5],
      temperature_2m_min: [15],
      precipitation_probability_max: [80],
    },
  });

  it("時間の無い応答は失敗（null）", () => {
    assert.equal(parseOpenMeteo({ hourly: {} }), null);
    assert.ok(forecast);
  });

  it("区間に掛かる時間の、いちばん荒れた天気・降水確率の最大・気温の幅", () => {
    assert.ok(forecast);
    assert.deepEqual(summarizeWindow(forecast, "2026-10-20", "07:30", "17:30"), {
      summary: "雨",
      code: 63,
      min: 18.5,
      max: 23.5,
      pop: 80,
      rainFrom: 10,
    });
    assert.equal(summarizeWindow(forecast, "2026-10-20", "18:30", "24:00")?.rainFrom, null);
    // 終わりの時刻ちょうどの時間は含めない
    assert.equal(summarizeWindow(forecast, "2026-10-20", "00:00", "10:00")?.pop, 20);
    assert.equal(summarizeWindow(forecast, "2026-10-20", "18:30", "24:00")?.summary, "くもり");
    assert.equal(summarizeWindow(forecast, "2026-10-23", "08:00", "22:00"), null);
  });

  it("この先3時間で雨になる最初の時刻", () => {
    assert.ok(forecast);
    assert.deepEqual(nextHours(forecast, "2026-10-20T08:00"), { pop: 80, rainFrom: "10:00" });
    assert.deepEqual(nextHours(forecast, "2026-10-20T16:00"), { pop: 20, rainFrom: null });
    assert.deepEqual(nextHours(forecast, "2026-10-21T00:00"), { pop: null, rainFrom: null });
  });

  it("判定のしきい値: 50%以上は雨、30〜49%は降るかも", () => {
    assert.equal(rainVerdict(50), "rain");
    assert.equal(rainVerdict(49), "maybe");
    assert.equal(rainVerdict(30), "maybe");
    assert.equal(rainVerdict(29), "dry");
    assert.equal(rainVerdict(null), "unknown");
  });
});

describe("1時間ごとの場所（#594）", () => {
  const today = buildStays(SCHEDULE)?.[0].stays ?? [];

  it("各時間の30分の時点に居る区間。区間の間（移動中）は次の区間、日の終わりの後は自宅", () => {
    // 〜06:30 自宅 / 07:30–17:30 栗東 / 18:30〜 自宅
    assert.deepEqual(placeAtHour(today, 5), { kind: "stay", index: 0 });
    assert.deepEqual(placeAtHour(today, 6), { kind: "move", index: 1 }); // 6:30 は自宅の終わりちょうど（含めない）
    assert.deepEqual(placeAtHour(today, 7), { kind: "stay", index: 1 });
    assert.deepEqual(placeAtHour(today, 16), { kind: "stay", index: 1 });
    assert.deepEqual(placeAtHour(today, 17), { kind: "move", index: 2 });
    assert.deepEqual(placeAtHour(today, 23), { kind: "stay", index: 2 });
  });

  it("最後の行き先が22:00で切れた後は、次の区間が無いので自宅で埋める", () => {
    const days = buildStays({
      configured: true,
      days: [{ date: "2026-10-19", travels: [{ title: "高槻市 → 大日", startTime: "06:42", endTime: "07:09" }] }],
    });
    const stays = days?.[0].stays ?? [];
    assert.deepEqual(placeAtHour(stays, 21), { kind: "stay", index: 1 });
    assert.deepEqual(placeAtHour(stays, 22), { kind: "home" });
  });

  it("区間が重なる時間は、後に始まる区間（より具体的な予定）を優先する", () => {
    const stays = buildStays({
      configured: true,
      days: [
        {
          date: "2026-10-20",
          events: [{ title: "打合せ", allDay: false, startTime: "10:00", endTime: "11:00", location: "京都市", outcome: null }],
          travels: [{ title: "自宅 → 栗東", origin: HOME_ADDRESS, destination: "栗東", startTime: "06:30", endTime: "07:30" }],
        },
      ],
    })?.[0].stays ?? [];
    const kyoto = stays.findIndex((stay) => stay.placeText === "京都市");
    const rittou = stays.findIndex((stay) => stay.placeText === "栗東");
    assert.deepEqual(placeAtHour(stays, 10), { kind: "stay", index: kyoto });
    assert.deepEqual(placeAtHour(stays, 9), { kind: "stay", index: rittou });
    assert.deepEqual(placeAtHour(stays, 11), { kind: "stay", index: rittou });
  });

  it("翌朝の区間は自宅込みで作る（行き先の無い日は終日自宅）", () => {
    const stays = tomorrowStaysWithHome(SCHEDULE);
    assert.deepEqual(
      stays.map((stay) => [stay.start, stay.end, stay.home]),
      [["08:00", "22:00", false]],
    );
    // 最初の区間より前（翌朝）は移動ではなく自宅
    assert.deepEqual(placeAtHour(stays, 3), { kind: "home" });
    const empty = tomorrowStaysWithHome({ configured: true, days: [SCHEDULE.days[0], { date: "2026-10-21", events: [], travels: [] }] });
    assert.deepEqual(empty.map((stay) => [stay.start, stay.end, stay.home]), [["00:00", "24:00", true]]);
    assert.deepEqual(tomorrowStaysWithHome({ configured: true, days: [SCHEDULE.days[0]] }), []);
  });

  it("開いた時刻によらず、いまから24時間ぶんを切り出す（#599）", () => {
    const rows = [
      ...Array.from({ length: 24 }, (_, hour) => ({ date: "2026-10-20", hour })),
      ...Array.from({ length: 24 }, (_, hour) => ({ date: "2026-10-21", hour })),
    ];
    const label = (row: { date: string; hour: number }) => `${row.date.slice(8)}:${row.hour}`;
    const morning = hoursFrom(rows, "2026-10-20", 7);
    assert.equal(morning.length, 24);
    assert.deepEqual([label(morning[0]), label(morning.at(-1)!)], ["20:7", "21:6"]);
    // 23時台に開いても翌4時で切れず、翌22時まで出る（#599の再現）
    const night = hoursFrom(rows, "2026-10-20", 23);
    assert.equal(night.length, 24);
    assert.deepEqual([label(night[0]), label(night[1]), label(night.at(-1)!)], ["20:23", "21:0", "21:22"]);
    assert.equal(hoursFrom(rows, "2026-10-20", 0).length, 24);
    // 材料が尽きる端（キャッシュが日付をまたいだ直後など）は、ある分だけ
    assert.deepEqual(hoursFrom(rows, "2026-10-21", 20).map(label), ["21:20", "21:21", "21:22", "21:23"]);
    assert.deepEqual(hoursFrom(rows, "2026-10-22", 0), []);
  });

  it("今日の0時からいまの24時間先までを切り出す（#609。過ぎた時間を含む）", () => {
    const rows = [
      ...Array.from({ length: 24 }, (_, hour) => ({ date: "2026-10-20", hour })),
      ...Array.from({ length: 24 }, (_, hour) => ({ date: "2026-10-21", hour })),
    ];
    const label = (row: { date: string; hour: number }) => `${row.date.slice(8)}:${row.hour}`;
    const morning = hoursSinceMidnight(rows, "2026-10-20", 9);
    assert.equal(morning.length, 9 + 24);
    assert.deepEqual([label(morning[0]), label(morning[9]), label(morning.at(-1)!)], ["20:0", "20:9", "21:8"]);
    // 材料が尽きる端は、ある分だけ
    assert.equal(hoursSinceMidnight(rows, "2026-10-20", 23).length, 47);
    assert.deepEqual(hoursSinceMidnight(rows, "2026-10-22", 0), []);
  });

  it("時間別の降水量（mm）を読む。無い時間はnull（#609）", () => {
    const parsed = parseOpenMeteo({
      hourly: { time: ["2026-10-20T00:00", "2026-10-20T01:00"], precipitation: [0.4] },
    });
    assert.deepEqual(parsed?.hourly.map((point) => point.precipitation), [0.4, null]);
  });

  it("予報からある時の点を引く", () => {
    const forecast = parseOpenMeteo({
      hourly: { time: ["2026-10-20T09:00"], weather_code: [61], temperature_2m: [18], precipitation_probability: [60] },
    });
    assert.ok(forecast);
    assert.equal(hourlyPoint(forecast, "2026-10-20", 9)?.pop, 60);
    assert.equal(hourlyPoint(forecast, "2026-10-20", 10), null);
  });
});

describe("mergeOverlappingStays（#608）", () => {
  const stay = (start: string, end: string, placeText: string, label: string | null, extra = {}) => ({
    date: "2026-10-24",
    start,
    end,
    placeText,
    home: false,
    label,
    allDay: false,
    ...extra,
  });

  it("同じ場所で重なる区間を1つにまとめ、時間帯は和集合・予定名は捨てる", () => {
    const merged = mergeOverlappingStays([stay("10:45", "14:00", "堺市北区", "お礼参り"), stay("12:00", "14:00", "堺市北区", "散髪")]);
    assert.deepEqual(merged, [stay("10:45", "14:00", "堺市北区", null)]);
  });

  it("接する区間もまとめる", () => {
    assert.equal(mergeOverlappingStays([stay("10:00", "11:00", "堺", null), stay("11:00", "12:00", "堺", null)]).length, 1);
  });

  it("場所が違う・離れた区間はまとめない", () => {
    assert.equal(mergeOverlappingStays([stay("10:00", "12:00", "堺", null), stay("11:00", "13:00", "京都", null)]).length, 2);
    assert.equal(mergeOverlappingStays([stay("10:00", "11:00", "堺", null), stay("12:00", "13:00", "堺", null)]).length, 2);
    assert.equal(mergeOverlappingStays([stay("10:00", "12:00", "自宅", null, { home: true }), stay("11:00", "13:00", "自宅", null)]).length, 2);
  });

  it("終日は全員が終日のときだけ残る", () => {
    const merged = mergeOverlappingStays([stay("08:00", "22:00", "堺", null, { allDay: true }), stay("10:00", "12:00", "堺", null)]);
    assert.equal(merged[0].allDay, false);
  });
});
