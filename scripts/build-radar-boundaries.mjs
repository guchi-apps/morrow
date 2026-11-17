#!/usr/bin/env node
// 雨雲レーダーの背景地図（#1068）の境界データを作る。依存なし。
//
// 入力: smartnews-smri/japan-topography の全国版 TopoJSON（国土交通省 国土数値情報「行政区域」N03を加工・簡素化1％）
//   https://raw.githubusercontent.com/smartnews-smri/japan-topography/main/data/municipality/topojson/s0010/N03-21_210101.json
// 出力: public/radar/japan-boundaries.json
//
// 湖: 行政区域は琵琶湖などを市町村の面に含めてしまい、湖が分けられない。そこで国土数値情報「湖沼」（W09-05。
//   https://nlftp.mlit.go.jp/ksj/gml/data/W09/W09-05/W09-05_GML.zip の W09-05-g_Lake.shp）のポリゴンを簡素化して
//   lakes に入れる（陸の上に海の色で重ねて描く）。
//
//   node scripts/build-radar-boundaries.mjs <入力のTopoJSON> <湖沼のshp> [出力先]
//
// TopoJSONは隣り合う面が境界の弧を共有する。弧を参照する面の数で次の3つに分ける:
//   coast … 1つの面だけが持つ弧（海岸線）。湖は行政区域では陸の一部なので、上の lakes で別に重ねる
//   pref  … 都道府県が違う面どうしが共有する弧（都道府県境）
//   muni  … 同じ都道府県の面どうしが共有する弧（市町村境）
// rings は塗りつぶし用（偶奇規則）。弧は元データの量子化した差分のまま持つ。
import fs from "node:fs";

const [input, lakeShp, output = "public/radar/japan-boundaries.json"] = process.argv.slice(2);
if (!input || !lakeShp) {
  console.error("使い方: node scripts/build-radar-boundaries.mjs <入力のTopoJSON> <湖沼のshp> [出力先]");
  process.exit(1);
}

const topology = JSON.parse(fs.readFileSync(input, "utf8"));
const geometries = Object.values(topology.objects)[0].geometries;

const owners = new Map(); // 弧 → 参照した面の添字の集合
const rings = [];
geometries.forEach((geometry, index) => {
  const polygons = geometry.type === "Polygon" ? [geometry.arcs] : geometry.arcs;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      rings.push(ring);
      for (const ref of ring) {
        const arc = ref >= 0 ? ref : ~ref;
        if (!owners.has(arc)) owners.set(arc, new Set());
        owners.get(arc).add(index);
      }
    }
  }
});

const coast = [];
const pref = [];
const muni = [];
for (const [arc, set] of owners) {
  const faces = [...set];
  if (faces.length < 2) {
    // 同じ面の飛び地どうしが共有する弧も1つの面扱い。海岸線として描く
    coast.push(arc);
    continue;
  }
  const prefectures = new Set(faces.map((face) => geometries[face].properties.N03_001));
  (prefectures.size > 1 ? pref : muni).push(arc);
}

// --- 湖沼（shpのポリゴン）---
/** この大きさ（度）より小さい湖は描かない（約1km。池は地図の上でただの点になる）。 */
const LAKE_MIN_SPAN = 0.008;
/** 間引きの許容（度。約30m）。 */
const SIMPLIFY_TOLERANCE = 0.0003;

function simplify(points, tolerance) {
  // 閉じた輪は始点と終点が同じで弦が0になるので、始点から一番遠い点で2つに分けて別々に間引く
  const first = points[0];
  const last = points[points.length - 1];
  if (points.length > 3 && first[0] === last[0] && first[1] === last[1]) {
    let far = 1;
    let farDistance = 0;
    for (let i = 1; i < points.length - 1; i++) {
      const distance = Math.hypot(points[i][0] - first[0], points[i][1] - first[1]);
      if (distance > farDistance) {
        farDistance = distance;
        far = i;
      }
    }
    return [...simplifyOpen(points.slice(0, far + 1), tolerance), ...simplifyOpen(points.slice(far), tolerance).slice(1)];
  }
  return simplifyOpen(points, tolerance);
}

function simplifyOpen(points, tolerance) {
  // Douglas-Peucker（反復版）
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0;
    let at = -1;
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-12;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((points[i][0] - ax) * dy - (points[i][1] - ay) * dx) / len;
      if (d > max) {
        max = d;
        at = i;
      }
    }
    if (max > tolerance) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function readLakes(file) {
  const shp = fs.readFileSync(file);
  const lakes = [];
  let off = 100;
  while (off < shp.length) {
    const length = shp.readUInt32BE(off + 4) * 2;
    const body = off + 8;
    if (shp.readInt32LE(body) === 5) {
      const bbox = [shp.readDoubleLE(body + 4), shp.readDoubleLE(body + 12), shp.readDoubleLE(body + 20), shp.readDoubleLE(body + 28)];
      const partCount = shp.readInt32LE(body + 36);
      const pointCount = shp.readInt32LE(body + 40);
      const starts = [];
      for (let i = 0; i < partCount; i++) starts.push(shp.readInt32LE(body + 44 + i * 4));
      starts.push(pointCount);
      const pointsAt = body + 44 + partCount * 4;
      const rings = [];
      for (let p = 0; p < partCount; p++) {
        const points = [];
        for (let i = starts[p]; i < starts[p + 1]; i++) {
          points.push([shp.readDoubleLE(pointsAt + i * 16), shp.readDoubleLE(pointsAt + i * 16 + 8)]);
        }
        const xs = points.map((point) => point[0]);
        const ys = points.map((point) => point[1]);
        // 小さな島・入り江の輪は落とす（湖そのものが小さければ全部落ちる）
        if (Math.max(...xs) - Math.min(...xs) < LAKE_MIN_SPAN && Math.max(...ys) - Math.min(...ys) < LAKE_MIN_SPAN) continue;
        const simple = simplify(points, SIMPLIFY_TOLERANCE);
        if (simple.length < 4) continue;
        rings.push(simple.flatMap(([lon, lat]) => [Math.round(lon * 1e4) / 1e4, Math.round(lat * 1e4) / 1e4]));
      }
      if (rings.length && bbox[2] - bbox[0] >= LAKE_MIN_SPAN) lakes.push(rings);
    }
    off += 8 + length;
  }
  return lakes;
}
const lakes = readLakes(lakeShp);

const out = { lakes, transform: topology.transform, arcs: topology.arcs, rings, coast, pref, muni };
fs.mkdirSync(output.replace(/\/[^/]+$/, ""), { recursive: true });
fs.writeFileSync(output, JSON.stringify(out));
console.log(
  `arcs=${topology.arcs.length} rings=${rings.length} coast=${coast.length} pref=${pref.length} muni=${muni.length} lakes=${lakes.length} → ${output} (${fs.statSync(output).size} bytes)`,
);
