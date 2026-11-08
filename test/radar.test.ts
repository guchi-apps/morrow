import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  baseTileUrl,
  buildFrames,
  carryFrameIndex,
  frameDate,
  isInRadarArea,
  hoursAfter,
  parseLongRangeTimes,
  parseTargetTimes,
  rainTileUrl,
  tilesFor,
} from "../src/lib/weather/radar.ts";

const time = (hhmm: string, base = hhmm) => ({ basetime: `20261102${base}00`, validtime: `20261102${hhmm}00` });

describe("parseTargetTimes", () => {
  it("降水の要素を持つ正しい行だけを読む", () => {
    const rows = [
      { basetime: "20261102123500", validtime: "20261102123500", elements: ["hrpns", "hrpns_nd"] },
      { basetime: "20261102123000", validtime: "20261102123000", elements: ["other"] },
      { basetime: "2026", validtime: "20261102122500", elements: ["hrpns"] },
      null,
    ];
    assert.deepEqual(parseTargetTimes(rows), [{ basetime: "20261102123500", validtime: "20261102123500" }]);
  });

  it("配列でないものは空", () => {
    assert.deepEqual(parseTargetTimes({ error: true }), []);
    assert.deepEqual(parseTargetTimes(null), []);
  });
});

describe("buildFrames", () => {
  it("最新の実況を「今」にして古い順に並べ、それ以前の予報は重ねない", () => {
    const frames = buildFrames(
      [time("1230"), time("1235"), time("1225")],
      [time("1240", "1230"), time("1235", "1230")],
    );
    assert.deepEqual(frames.map((frame) => [frame.validtime.slice(8, 12), frame.kind]), [
      ["1225", "past"],
      ["1230", "past"],
      ["1235", "now"],
      ["1240", "forecast"],
    ]);
  });

  it("前後は12コマまで", () => {
    const stamp = (minutes: number) => {
      const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
      const mm = String(minutes % 60).padStart(2, "0");
      return time(`${hh}${mm}`);
    };
    const past = Array.from({ length: 37 }, (_, i) => stamp(i * 5));
    const forecast = Array.from({ length: 20 }, (_, i) => stamp(185 + i * 5));
    const frames = buildFrames(past, forecast);
    assert.equal(frames.length, 25);
    assert.equal(frames.findIndex((frame) => frame.kind === "now"), 12);
  });

  it("実況が無ければ空、予報が無くても実況だけで作る", () => {
    assert.deepEqual(buildFrames([], [time("1240")]), []);
    assert.equal(buildFrames([time("1235")], []).length, 1);
  });
});

describe("frameDate", () => {
  it("一覧の時刻をUTCとして読む", () => {
    assert.equal(frameDate("20261102123500").toISOString(), "2026-11-02T12:35:00.000Z");
  });
});

describe("isInRadarArea", () => {
  it("日本は範囲内、海外は範囲外", () => {
    assert.equal(isInRadarArea(35.02, 135.99), true);
    assert.equal(isInRadarArea(26.2, 127.68), true);
    assert.equal(isInRadarArea(43.06, 141.35), true);
    assert.equal(isInRadarArea(21.3, -157.86), false);
    assert.equal(isInRadarArea(51.5, -0.12), false);
  });
});

describe("tilesFor", () => {
  it("地点を含むタイルを返し、枠の中心が地点に当たる", () => {
    const tiles = tilesFor(35.02, 135.99, 10, 300, 225);
    const home = tiles.find((tile) => tile.x === 898 && tile.y === 405);
    assert.ok(home);
    // 地点はタイル(898,405)の約(209,137)px。枠の中心(150,112)からの差がタイルの位置になる。
    assert.ok(Math.abs(home.left + 209 - 150) <= 2);
    assert.ok(Math.abs(home.top + 137 - 112) <= 2);
  });

  it("枠を隙間なく覆い、枠の外のタイルを含まない", () => {
    const [width, height] = [512, 384];
    const tiles = tilesFor(35.02, 135.99, 8, width, height);
    for (const tile of tiles) {
      assert.ok(tile.left < width && tile.left + 256 > 0);
      assert.ok(tile.top < height && tile.top + 256 > 0);
    }
    assert.equal(Math.min(...tiles.map((tile) => tile.left)) <= 0, true);
    assert.equal(Math.max(...tiles.map((tile) => tile.left + 256)) >= width, true);
    assert.equal(Math.max(...tiles.map((tile) => tile.top + 256)) >= height, true);
  });

  it("大きさが決まる前は読み込まない", () => {
    assert.deepEqual(tilesFor(35, 135, 10, 0, 0), []);
  });
});

describe("URL", () => {
  it("地図と雨雲のタイルを組み立てる", () => {
    assert.equal(baseTileUrl(10, { x: 898, y: 405 }), "https://cyberjapandata.gsi.go.jp/xyz/pale/10/898/405.png");
    assert.equal(
      rainTileUrl(time("1240", "1230"), 10, { x: 898, y: 405 }),
      "https://www.jma.go.jp/bosai/jmatile/data/nowc/20261102123000/none/20261102124000/surf/hrpns/10/898/405.png",
    );
  });
});

describe("carryFrameIndex", () => {
  const frames = buildFrames([time("1225"), time("1230"), time("1235")], [time("1240", "1230")]);

  it("「今」を見ていたら新しい「今」へ移る", () => {
    assert.equal(carryFrameIndex({ ...time("1230"), kind: "now" }, frames), 2);
    assert.equal(carryFrameIndex(undefined, frames), 2);
  });

  it("過去を見ていたら同じ時刻に留まり、無くなっていたら「今」へ", () => {
    assert.equal(carryFrameIndex({ ...time("1225"), kind: "past" }, frames), 0);
    assert.equal(carryFrameIndex({ ...time("1100"), kind: "past" }, frames), 2);
  });
});

describe("降水短時間予報（#666）", () => {
  const row = (basetime: string, validtime: string, member: string, elements = ["rasrf", "rasrf_point"]) => ({
    basetime: `20261102${basetime}00`,
    validtime: `20261102${validtime}00`,
    member,
    elements,
  });

  it("降水の予報だけを読み、同じ時刻は新しい基準時刻を使う", () => {
    const times = parseLongRangeTimes([
      row("1400", "2100", "none"),
      row("1440", "2100", "immed"),
      row("1400", "1400", "none"), // 解析値（基準時刻と同じ）
      row("1440", "1500", "immed", ["sjfcstmap"]), // 別の製品
      { basetime: "x", validtime: "20261102210000", member: "none", elements: ["rasrf"] },
    ]);
    assert.deepEqual(times, [{ basetime: "20261102144000", validtime: "20261102210000", member: "immed" }]);
    assert.deepEqual(parseLongRangeTimes(null), []);
  });

  it("ナウキャストが終わった後の時刻だけを継ぎ足す", () => {
    const long = parseLongRangeTimes([row("1230", "1240", "immed"), row("1230", "1335", "immed"), row("1230", "1440", "immed")]);
    const frames = buildFrames([time("1235")], [time("1240", "1235"), time("1330", "1235")], long);
    assert.deepEqual(frames.map((frame) => frame.validtime.slice(8, 12)), ["1235", "1240", "1330", "1335", "1440"]);
    assert.equal(frames.at(-1)?.kind, "forecast");
    assert.equal(hoursAfter(frames[0], frames.at(-1)!), 2);
  });

  it("タイルのURLは製品ごとの形になる", () => {
    const tile = { x: 227, y: 100 };
    assert.equal(
      rainTileUrl({ basetime: "20261103144000", validtime: "20261103164000", member: "immed" }, 8, tile),
      "https://www.jma.go.jp/bosai/jmatile/data/rasrf/20261103144000/immed/20261103164000/surf/rasrf/8/227/100.png",
    );
    assert.match(rainTileUrl({ basetime: "a", validtime: "b" }, 8, tile), /nowc\/a\/none\/b\/surf\/hrpns\/8\/227\/100\.png$/);
  });
});
