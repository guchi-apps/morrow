import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  type BasemapContext,
  DARK_PALETTE,
  LIGHT_PALETTE,
  MUNI_MIN_ZOOM,
  basemapView,
  boxVisible,
  drawBasemap,
  parseBoundaries,
  worldPx,
} from "../src/lib/weather/radar-basemap.ts";

const data = parseBoundaries(JSON.parse(readFileSync("public/radar/japan-boundaries.json", "utf8")));

function fakeContext() {
  const calls: string[] = [];
  const strokes: { color: string; width: number }[] = [];
  const ctx: BasemapContext = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    lineJoin: "miter",
    fillRect: () => calls.push("fillRect"),
    beginPath: () => calls.push("beginPath"),
    moveTo: () => calls.push("moveTo"),
    lineTo: () => calls.push("lineTo"),
    closePath: () => calls.push("closePath"),
    fill: (rule) => calls.push(`fill:${rule}`),
    stroke: () => strokes.push({ color: String(ctx.strokeStyle), width: ctx.lineWidth }),
  };
  return { ctx, calls, strokes };
}

describe("境界データ（public/radar/japan-boundaries.json）", () => {
  it("同梱のJSONを読めて、海岸線・都道府県境・市町村境が分かれている", () => {
    assert.ok(data);
    assert.ok(data.coast.length > 0 && data.pref.length > 0 && data.muni.length > 0);
    // 湖（琵琶湖）は行政区域では陸の一部なので、別に持っている
    const biwa = data.lakes.find((lake) => lake.minLon > 135.8 && lake.maxLon < 136.3 && lake.maxLat - lake.minLat > 0.4);
    assert.ok(biwa, "琵琶湖がlakesにある");
    // どの面も参照しない弧は分類されない（元データに1本ある）
    assert.ok(data.coast.length + data.pref.length + data.muni.length >= data.arcs.length - 5);
    // 日本の範囲に収まる
    for (const arc of data.arcs) assert.ok(arc.minLon > 120 && arc.maxLon < 155 && arc.minLat > 20 && arc.maxLat < 47);
  });

  it("形が違うデータは読まずにnullを返す", () => {
    assert.equal(parseBoundaries(null), null);
    assert.equal(parseBoundaries({}), null);
    assert.equal(
      parseBoundaries({ transform: { scale: [1, 1], translate: [0, 0] }, arcs: [], rings: [[3]], coast: [], pref: [], muni: [], lakes: [] }),
      null,
    );
  });
});

describe("投影と間引き", () => {
  it("中心は枠の真ん中に来る", () => {
    const view = basemapView(35, 135, 10, 512, 384);
    const center = worldPx(35, 135, 10);
    assert.equal(Math.round(center.x - view.left), 256);
    assert.equal(Math.round(center.y - view.top), 192);
  });

  it("枠から遠い範囲・1px未満の範囲は描かない", () => {
    const view = basemapView(35, 135, 10, 512, 384);
    assert.equal(boxVisible({ minLon: 134.9, maxLon: 135.1, minLat: 34.9, maxLat: 35.1 }, view), true);
    assert.equal(boxVisible({ minLon: 139, maxLon: 140, minLat: 35, maxLat: 36 }, view), false);
    assert.equal(boxVisible({ minLon: 135, maxLon: 135.00001, minLat: 35, maxLat: 35.00001 }, view), false);
  });
});

describe("drawBasemap", () => {
  it("近い拡大では市町村境まで、遠いと都道府県境と海岸線だけを描く", () => {
    assert.ok(data);
    const near = fakeContext();
    drawBasemap(near.ctx, data, basemapView(34.85, 135.62, 10, 512, 384), LIGHT_PALETTE);
    // 市町村境→都道府県境→湖岸→海岸線（この範囲には琵琶湖が入る）
    assert.deepEqual(near.strokes.map((s) => s.color), [LIGHT_PALETTE.muni, LIGHT_PALETTE.pref, LIGHT_PALETTE.coast, LIGHT_PALETTE.coast]);
    assert.ok(near.calls.includes("fill:evenodd"));
    assert.ok(near.calls.filter((c) => c === "lineTo").length > 100);

    const far = fakeContext();
    drawBasemap(far.ctx, data, basemapView(34.85, 135.62, MUNI_MIN_ZOOM - 1, 512, 384), DARK_PALETTE);
    assert.ok(!far.strokes.some((s) => s.color === DARK_PALETTE.muni));
    assert.equal(far.strokes[0].color, DARK_PALETTE.pref);
  });
});
