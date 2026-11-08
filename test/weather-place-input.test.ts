/**
 * 天気ページ（#695）の地点の入力検証・URLの往復・市町村の候補の選び方。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cleanPlaceName, parsePlaceInput, placeFromQuery, weatherHref } from "../src/lib/weather/place-input.ts";
import { municipalityCandidates } from "../src/lib/weather/rain-check.ts";

describe("parsePlaceInput", () => {
  it("座標を小数2桁に丸め、名前の空白・改行を畳む", () => {
    assert.deepEqual(parsePlaceInput({ name: " 三条市\n ", latitude: 37.6361234, longitude: 138.9612 }), {
      name: "三条市",
      latitude: 37.64,
      longitude: 138.96,
    });
  });
  it("名前が空・座標が範囲外・数値でないものは落とす", () => {
    assert.equal(parsePlaceInput({ name: "  ", latitude: 35, longitude: 135 }), null);
    assert.equal(parsePlaceInput({ name: "x", latitude: 91, longitude: 135 }), null);
    assert.equal(parsePlaceInput({ name: "x", latitude: "35", longitude: 135 }), null);
    assert.equal(parsePlaceInput({ name: "x", latitude: 35, longitude: Number.NaN }), null);
  });
  it("名前は40文字で切る", () => {
    assert.equal(cleanPlaceName("あ".repeat(60)).length, 40);
  });
});

describe("weatherHref / placeFromQuery", () => {
  it("URLに載せた地点を読み戻せる（日付は付けない形と付ける形）", () => {
    const place = { name: "燕市", latitude: 37.67, longitude: 138.88 };
    const href = weatherHref(place, "2026-11-09");
    const params = Object.fromEntries(new URL(href, "http://x").searchParams);
    assert.equal(params.d, "2026-11-09");
    assert.deepEqual(placeFromQuery(params), place);
    assert.equal(new URL(weatherHref(place), "http://x").searchParams.has("d"), false);
  });
  it("座標が読めない・欠けていれば null", () => {
    assert.equal(placeFromQuery({ n: "x", lat: "abc", lon: "135" }), null);
    assert.equal(placeFromQuery({ n: "x", lat: "35" }), null);
    assert.equal(placeFromQuery({ n: "x", lat: "35", lon: "1e3" }), null);
    assert.equal(placeFromQuery({ n: "x", lat: "999", lon: "135" }), null);
  });
});

describe("municipalityCandidates", () => {
  const found = [
    { title: "新潟県三条市", latitude: 37.63, longitude: 138.96 },
    { title: "新潟県三条市", latitude: 37.634, longitude: 138.964 },
    { title: "新潟県三条市本町", latitude: 37.63, longitude: 138.96 },
    { title: "京都府京都市中京区三条通", latitude: 35.01, longitude: 135.76 },
    { title: "新潟県燕市", latitude: 37.67, longitude: 138.88 },
  ];
  it("市町村の題だけを残し、同じ地点（小数2桁）は1つにまとめる", () => {
    const result = municipalityCandidates("三条", found);
    assert.deepEqual(result.map((item) => item.name), ["三条市"]);
    assert.equal(result[0].title, "新潟県三条市");
  });
  it("空の検索語・当たらない語は空", () => {
    assert.deepEqual(municipalityCandidates("  ", found), []);
    assert.deepEqual(municipalityCandidates("札幌", found), []);
  });
  it("件数の上限を守る", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ title: `県${i}三条市`.replace("県", "新潟県"), latitude: 30 + i, longitude: 130 }));
    assert.equal(municipalityCandidates("三条", many, 3).length, 3);
  });
});
