/**
 * 雨雲レーダーの背景地図（#1068）。行政区域（国土数値情報のN03を簡素化したTopoJSON由来。`public/radar/japan-boundaries.json`）を
 * Canvasで描く。地理院タイルをやめた理由は、拡大するとぼやけ、海岸線・湖・都道府県境・市町村境を自由に描き分けられないため。
 *
 * 純粋な計算（投影・間引き・描画命令）だけを置く。DOMにもネットワークにも触れない。生成は `scripts/build-radar-boundaries.mjs`。
 */

const TILE_PX = 256;
/** この拡大より小さいと市町村境は細かすぎて塗りつぶしになるので描かない。 */
export const MUNI_MIN_ZOOM = 7.5;

export type BoundaryArc = {
  /** lon, lat の並び */
  points: Float64Array;
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
};

export type Boundaries = {
  arcs: BoundaryArc[];
  rings: { refs: number[]; minLon: number; maxLon: number; minLat: number; maxLat: number }[];
  coast: number[];
  pref: number[];
  muni: number[];
  /** 湖（国土数値情報「湖沼」。行政区域では陸の一部になってしまうため別に持つ）。輪は lon, lat の並び。 */
  lakes: { rings: Float64Array[]; minLon: number; maxLon: number; minLat: number; maxLat: number }[];
};

export type BasemapPalette = {
  sea: string;
  land: string;
  coast: string;
  pref: string;
  muni: string;
};

export const LIGHT_PALETTE: BasemapPalette = { sea: "#d7e3ee", land: "#ffffff", coast: "#7b8a99", pref: "#8d93a0", muni: "#c3c8d0" };
export const DARK_PALETTE: BasemapPalette = { sea: "#16181c", land: "#25282d", coast: "#6f7a86", pref: "#69707c", muni: "#40454d" };

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number");
}

/** 同梱JSONを検証して、描きやすい形（経緯度の配列）へ展開する。形が違えばnull。 */
export function parseBoundaries(json: unknown): Boundaries | null {
  if (typeof json !== "object" || json === null) return null;
  const data = json as Record<string, unknown>;
  const transform = data.transform as { scale?: unknown; translate?: unknown } | undefined;
  if (!transform || !isNumberArray(transform.scale) || !isNumberArray(transform.translate)) return null;
  if (!Array.isArray(data.arcs) || !Array.isArray(data.rings)) return null;
  if (!isNumberArray(data.coast) || !isNumberArray(data.pref) || !isNumberArray(data.muni)) return null;
  const [sx, sy] = transform.scale;
  const [tx, ty] = transform.translate;

  const arcs: BoundaryArc[] = [];
  for (const raw of data.arcs as unknown[]) {
    if (!Array.isArray(raw)) return null;
    const points = new Float64Array(raw.length * 2);
    let x = 0;
    let y = 0;
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (let i = 0; i < raw.length; i++) {
      const delta = raw[i] as unknown;
      if (!isNumberArray(delta) || delta.length < 2) return null;
      x += delta[0];
      y += delta[1];
      const lon = x * sx + tx;
      const lat = y * sy + ty;
      points[i * 2] = lon;
      points[i * 2 + 1] = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    arcs.push({ points, minLon, maxLon, minLat, maxLat });
  }

  const rings: Boundaries["rings"] = [];
  for (const raw of data.rings as unknown[]) {
    if (!isNumberArray(raw)) return null;
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const ref of raw) {
      const arc = arcs[ref >= 0 ? ref : ~ref];
      if (!arc) return null;
      minLon = Math.min(minLon, arc.minLon);
      maxLon = Math.max(maxLon, arc.maxLon);
      minLat = Math.min(minLat, arc.minLat);
      maxLat = Math.max(maxLat, arc.maxLat);
    }
    rings.push({ refs: raw, minLon, maxLon, minLat, maxLat });
  }
  for (const list of [data.coast, data.pref, data.muni]) {
    if (list.some((index) => !arcs[index])) return null;
  }

  const lakes: Boundaries["lakes"] = [];
  if (!Array.isArray(data.lakes)) return null;
  for (const lake of data.lakes as unknown[]) {
    if (!Array.isArray(lake)) return null;
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    const lakeRings: Float64Array[] = [];
    for (const ring of lake as unknown[]) {
      if (!isNumberArray(ring) || ring.length < 6 || ring.length % 2 !== 0) return null;
      for (let i = 0; i < ring.length; i += 2) {
        minLon = Math.min(minLon, ring[i]);
        maxLon = Math.max(maxLon, ring[i]);
        minLat = Math.min(minLat, ring[i + 1]);
        maxLat = Math.max(maxLat, ring[i + 1]);
      }
      lakeRings.push(Float64Array.from(ring));
    }
    lakes.push({ rings: lakeRings, minLon, maxLon, minLat, maxLat });
  }
  return { arcs, rings, coast: data.coast, pref: data.pref, muni: data.muni, lakes };
}

/** 表示している範囲。枠の中心に（lat, lon）を置いたときの、世界のpx座標での左上。 */
export type BasemapView = { left: number; top: number; width: number; height: number; zoom: number };

/** 経緯度→ズーム `zoom` の世界px（Webメルカトル。雨雲タイル・マーカーと同じ式）。 */
export function worldPx(latitude: number, longitude: number, zoom: number): { x: number; y: number } {
  const world = 2 ** zoom * TILE_PX;
  const sinLat = Math.sin((latitude * Math.PI) / 180);
  return {
    x: ((longitude + 180) / 360) * world,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * world,
  };
}

export function basemapView(latitude: number, longitude: number, zoom: number, width: number, height: number): BasemapView {
  const center = worldPx(latitude, longitude, zoom);
  return { left: center.x - width / 2, top: center.y - height / 2, width, height, zoom };
}

type Box = { minLon: number; maxLon: number; minLat: number; maxLat: number };

/** 枠に掛かる（または1px以上の大きさがある）か。余白 `pad` px ぶん広く見る。 */
export function boxVisible(box: Box, view: BasemapView, pad = 8): boolean {
  const a = worldPx(box.maxLat, box.minLon, view.zoom); // 左上
  const b = worldPx(box.minLat, box.maxLon, view.zoom); // 右下
  if (b.x - a.x < 0.5 && b.y - a.y < 0.5) return false;
  return b.x >= view.left - pad && a.x <= view.left + view.width + pad && b.y >= view.top - pad && a.y <= view.top + view.height + pad;
}

/** 描画に使うCanvasの最小の形（テストで差し替えられるように）。 */
export type BasemapContext = {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineJoin: CanvasLineJoin;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  fill(rule?: CanvasFillRule): void;
  stroke(): void;
};

function tracePoints(ctx: BasemapContext, arc: BoundaryArc, view: BasemapView, reverse: boolean, skipFirst: boolean, move: boolean) {
  const count = arc.points.length / 2;
  const world = 2 ** view.zoom * TILE_PX;
  for (let n = skipFirst ? 1 : 0; n < count; n++) {
    const i = reverse ? count - 1 - n : n;
    const lon = arc.points[i * 2];
    const lat = arc.points[i * 2 + 1];
    const sinLat = Math.sin((lat * Math.PI) / 180);
    const x = ((lon + 180) / 360) * world - view.left;
    const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * world - view.top;
    if (move && n === (skipFirst ? 1 : 0)) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

/** 背景地図を描く。海→陸→市町村境→都道府県境→湖（海の色で重ねる）→海岸線の順。 */
export function drawBasemap(ctx: BasemapContext, data: Boundaries, view: BasemapView, palette: BasemapPalette): void {
  ctx.fillStyle = palette.sea;
  ctx.fillRect(0, 0, view.width, view.height);

  ctx.fillStyle = palette.land;
  ctx.beginPath();
  for (const ring of data.rings) {
    if (!boxVisible(ring, view)) continue;
    let first = true;
    for (const ref of ring.refs) {
      const reverse = ref < 0;
      tracePoints(ctx, data.arcs[reverse ? ~ref : ref], view, reverse, !first, first);
      first = false;
    }
    ctx.closePath();
  }
  ctx.fill("evenodd");

  ctx.lineJoin = "round";
  const strokeArcs = (indices: number[], color: string, width: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (const index of indices) {
      const arc = data.arcs[index];
      if (!boxVisible(arc, view)) continue;
      tracePoints(ctx, arc, view, false, false, true);
    }
    ctx.stroke();
  };
  if (view.zoom >= MUNI_MIN_ZOOM) strokeArcs(data.muni, palette.muni, 0.8);
  strokeArcs(data.pref, palette.pref, 1.4);

  // 湖は行政区域の面の上に重ねる（境界線も隠れる）。湖の中の島は偶奇規則で抜ける
  const world = 2 ** view.zoom * TILE_PX;
  let lakeCount = 0;
  ctx.beginPath();
  for (const lake of data.lakes) {
    if (!boxVisible(lake, view)) continue;
    for (const ring of lake.rings) {
      for (let i = 0; i < ring.length; i += 2) {
        const sinLat = Math.sin((ring[i + 1] * Math.PI) / 180);
        const x = ((ring[i] + 180) / 360) * world - view.left;
        const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * world - view.top;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      lakeCount++;
    }
  }
  ctx.fillStyle = palette.sea;
  ctx.fill("evenodd");
  if (lakeCount > 0) {
    ctx.strokeStyle = palette.coast;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  strokeArcs(data.coast, palette.coast, 1);
}
