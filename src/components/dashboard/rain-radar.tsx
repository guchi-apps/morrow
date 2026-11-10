"use client";

import { Crosshair, Minus, Pause, Play, Plus } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { jstTimeLabel } from "@/lib/day-key";
import { cn } from "@/lib/utils";
import {
  RADAR_FORECAST_TIMES_URL,
  RADAR_LONG_TIMES_URL,
  RADAR_PAST_TIMES_URL,
  RADAR_ZOOM_DEFAULT,
  RADAR_ZOOM_MAX,
  RADAR_ZOOM_MIN,
  type RadarFrame,
  type RadarTime,
  type RadarTile,
  baseTileUrl,
  buildFrames,
  carryFrameIndex,
  clampZoom,
  frameDate,
  hoursAfter,
  panCenter,
  parseLongRangeTimes,
  parseTargetTimes,
  rainTileUrl,
  scaleLabel,
  splitZoom,
  tilesFor,
  viewWidthKm,
} from "@/lib/weather/radar";

/**
 * 現在地の雨雲レーダー（#654）。「現在地」を開いたときだけ描かれ、そのときに初めて読み込む。
 *
 * - **タイルはブラウザから気象庁・国土地理院へ直接取りに行く。** 相手に見えるのはIPとタイル番号（約30km単位）で、正確な座標は
 *   渡さず、リファラも送らない。サーバー経由にしないのは、middlewareがタイル1枚ごとにSupabaseへ往復するため（認証を外せば公開プロキシになる）
 * - **取れなかったタイルを「雨なし」に見せない**（#214）。雨雲タイルが失敗したコマは、地図の下に赤で知らせる
 * - 雨雲のコマは開いた時点では「今」だけを読み、動かしたときに読む。再生は表示中のコマが出揃ってから次へ進むので、遅い回線でも飛ばない
 */

const FRAME_MS = 500;
/** 枠の外へ余分に読むタイルの幅（動かした直後に地図が欠けないように）。 */
const TILE_MARGIN_PX = 128;
const KEY_PAN_PX = 64;
const TIMES_TIMEOUT_MS = 10_000;
/** 開いている間に一覧を取り直す間隔（実況は5分ごとに増える）。 */
const REFRESH_MS = 5 * 60_000;

const LEGEND = [
  { color: "#a0d2ff", label: "1" },
  { color: "#218cff", label: "5" },
  { color: "#0041ff", label: "10" },
  { color: "#faf500", label: "20" },
  { color: "#ff9900", label: "30" },
  { color: "#ff2800", label: "50" },
  { color: "#b40068", label: "80" },
];

const KIND_LABEL: Record<RadarFrame["kind"], string> = { past: "実況", now: "今", forecast: "予報" };

function frameLabel(frame: RadarFrame): string {
  return `${jstTimeLabel(frameDate(frame.validtime))} ${KIND_LABEL[frame.kind]}`;
}

async function fetchTimes(url: string, parse: (json: unknown) => RadarTime[] = parseTargetTimes) {
  const response = await fetch(url, { referrerPolicy: "no-referrer", signal: AbortSignal.timeout(TIMES_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parse(await response.json());
}

function TileImage({
  src,
  tile,
  onDone,
  onFailed,
}: {
  src: string;
  tile: RadarTile;
  onDone: () => void;
  onFailed?: () => void;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 外部のタイルをそのまま並べる。最適化を通すとサーバー経由になる
    <img
      src={src}
      alt=""
      width={256}
      height={256}
      draggable={false}
      referrerPolicy="no-referrer"
      onLoad={onDone}
      onError={() => {
        onDone();
        onFailed?.();
      }}
      className="absolute max-w-none select-none"
      style={{ left: tile.left, top: tile.top }}
    />
  );
}

export function RainRadar({
  latitude,
  longitude,
  centerLabel = "現在地",
}: {
  latitude: number;
  longitude: number;
  /** 地図の中心の点の読み上げ名（天気ページでは選んだ地点の名前を渡す）。 */
  centerLabel?: string;
}) {
  const [frames, setFrames] = useState<RadarFrame[] | null>(null);
  const [hasForecast, setHasForecast] = useState(true);
  const [hasLongRange, setHasLongRange] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState<number>(RADAR_ZOOM_DEFAULT);
  // 地図の中心（ドラッグで動く）。null＝選んだ地点のまま
  const [panned, setPanned] = useState<{ latitude: number; longitude: number } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  // 読み込みに手を付けたコマ（validtime）。開いた時点では「今」だけ。
  const [requested, setRequested] = useState<ReadonlySet<string>>(new Set());
  const [settled, setSettled] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [shownTime, setShownTime] = useState<string | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);
  const viewRef = useRef({ latitude, longitude, zoom: RADAR_ZOOM_DEFAULT });
  // 取り直しの非同期処理から「いま見ているコマ」を読むための控え（描画には使わない）。
  const currentRef = useRef<RadarFrame | undefined>(undefined);

  const current = frames?.[index];
  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [past, forecast, longRange] = await Promise.allSettled([
        fetchTimes(RADAR_PAST_TIMES_URL),
        fetchTimes(RADAR_FORECAST_TIMES_URL),
        fetchTimes(RADAR_LONG_TIMES_URL, parseLongRangeTimes),
      ]);
      if (cancelled) return;
      const built = buildFrames(
        past.status === "fulfilled" ? past.value : [],
        forecast.status === "fulfilled" ? forecast.value : [],
        longRange.status === "fulfilled" ? longRange.value : [],
      );
      if (built.length === 0) {
        if (past.status === "rejected") console.error("[aide-bot] 雨雲の時刻を取得できなかった", past.reason);
        // 取り直しの失敗では、表示中のレーダーを消さない
        if (!currentRef.current) setLoadFailed(true);
        return;
      }
      setLoadFailed(false);
      setHasForecast(built.some((frame) => frame.kind === "forecast"));
      setHasLongRange(longRange.status === "fulfilled" && longRange.value.length > 0);
      const nextIndex = carryFrameIndex(currentRef.current, built);
      setFrames(built);
      setIndex(nextIndex);
      setRequested((prev) => new Set(prev).add(built[nextIndex].validtime));
    }
    function refreshIfVisible() {
      if (document.visibilityState === "visible") void load();
    }
    void load();
    const timer = setInterval(refreshIfVisible, REFRESH_MS);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [retry]);

  // 枠の大きさに掛かるタイルだけを読む。
  useLayoutEffect(() => {
    const node = mapRef.current;
    if (!node) return;
    const measure = () => setSize({ width: node.clientWidth, height: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [frames === null]); // eslint-disable-line react-hooks/exhaustive-deps -- 地図の枠は一覧が届いてから現れる

  const centerLat = panned?.latitude ?? latitude;
  const centerLon = panned?.longitude ?? longitude;
  const { tileZoom, scale } = splitZoom(zoom);
  // 拡大率ぶん、枠より広い（または狭い）範囲のタイルを読み、中心から拡大率を掛けて枠に収める
  const innerWidth = size.width / scale + TILE_MARGIN_PX * 2;
  const innerHeight = size.height / scale + TILE_MARGIN_PX * 2;
  const tiles = useMemo(
    () => tilesFor(centerLat, centerLon, tileZoom, innerWidth, innerHeight),
    [centerLat, centerLon, tileZoom, innerWidth, innerHeight],
  );
  useEffect(() => {
    viewRef.current = { latitude: centerLat, longitude: centerLon, zoom };
  }, [centerLat, centerLon, zoom]);

  // 中心の点（選んだ地点）の枠内の位置。地図を動かすと一緒に動く
  const markerOffset = (() => {
    const at = (lat: number, lon: number) => {
      const world = 2 ** zoom * 256;
      const sin = Math.sin((lat * Math.PI) / 180);
      return { x: ((lon + 180) / 360) * world, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * world };
    };
    const target = at(latitude, longitude);
    const center = at(centerLat, centerLon);
    return { x: target.x - center.x, y: target.y - center.y };
  })();
  const markerVisible = Math.abs(markerOffset.x) < size.width / 2 && Math.abs(markerOffset.y) < size.height / 2;

  const zoomBy = (delta: number) => setZoom((value) => clampZoom(value + delta));
  const dragBy = (dx: number, dy: number) => {
    const view = viewRef.current;
    setPanned(panCenter(view.latitude, view.longitude, view.zoom, dx, dy));
  };
  const resetView = () => {
    setPanned(null);
    setZoom(RADAR_ZOOM_DEFAULT);
  };
  const moved = panned !== null || zoom !== RADAR_ZOOM_DEFAULT;

  // ホイールで拡大縮小（ページのスクロールを止めるため passive: false で付ける）
  useEffect(() => {
    const node = mapRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoom((value) => clampZoom(value - event.deltaY * 0.0025));
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [frames === null]); // eslint-disable-line react-hooks/exhaustive-deps -- 地図の枠は一覧が届いてから現れる

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchRef.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: viewRef.current.zoom };
    }
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size >= 2 && pinchRef.current) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchRef.current.distance > 0) {
        setZoom(clampZoom(pinchRef.current.zoom + Math.log2(distance / pinchRef.current.distance)));
      }
      return;
    }
    dragBy(event.clientX - previous.x, event.clientY - previous.y);
  };
  const onPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    pinchRef.current = null;
    // 2本指から1本が残ったときは、残った指の位置から動かし直す（ずれた差分で飛ばない）
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [KEY_PAN_PX, 0],
      ArrowRight: [-KEY_PAN_PX, 0],
      ArrowUp: [0, KEY_PAN_PX],
      ArrowDown: [0, -KEY_PAN_PX],
    };
    const arrow = arrows[event.key];
    if (arrow) {
      event.preventDefault();
      dragBy(arrow[0], arrow[1]);
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomBy(0.5);
    } else if (event.key === "-") {
      event.preventDefault();
      zoomBy(-0.5);
    }
  };

  // 選んだコマが出揃うまでは前のコマを出したままにする（切り替えのたびに雨雲が消えて点滅しないように）。
  const urlsOf = (frame: RadarFrame) => tiles.map((tile) => rainTileUrl(frame, tileZoom, tile));
  const isSettled = (frame: RadarFrame) => tiles.length > 0 && urlsOf(frame).every((url) => settled.has(url));
  if (current && shownTime !== current.validtime && isSettled(current)) {
    setShownTime(current.validtime);
  }

  // 再生は表示中のコマが出揃ってから次へ進む。
  const ready = !!current && shownTime === current.validtime;
  useEffect(() => {
    if (!playing || !ready || !frames) return;
    const timer = setTimeout(() => {
      setIndex((value) => (value + 1) % frames.length);
    }, FRAME_MS);
    return () => clearTimeout(timer);
  }, [playing, ready, frames, index]);

  const select = (next: number) => {
    if (!frames?.[next]) return;
    setIndex(next);
    setRequested((prev) => new Set(prev).add(frames[next].validtime));
  };

  const togglePlay = () => {
    if (!frames) return;
    if (!playing) setRequested(new Set(frames.map((frame) => frame.validtime)));
    setPlaying(!playing);
  };

  if (loadFailed) {
    return (
      <Section>
        <p role="status" className="rounded-[10px] bg-danger-surface px-3 py-2.5 leading-relaxed text-danger">
          雨雲を取得できませんでした。雨が降っているかは分かりません。
          <button
            type="button"
            onClick={() => {
              setLoadFailed(false);
              setRetry((value) => value + 1);
            }}
            className="ml-1 underline focus-visible:outline-2 focus-visible:outline-accent"
          >
            もう一度試す
          </button>
        </p>
      </Section>
    );
  }
  if (!frames || !current) {
    return (
      <Section>
        <p className="text-xs text-muted">雨雲を取得しています…</p>
      </Section>
    );
  }

  const nowIndex = frames.findIndex((frame) => frame.kind === "now");
  const lastIndex = frames.length - 1;
  const currentFailed = urlsOf(current).some((url) => failed.has(url));
  const layers = frames.filter((frame) => requested.has(frame.validtime));
  const markSettled = (url: string) => setSettled((prev) => (prev.has(url) ? prev : new Set(prev).add(url)));

  return (
    <Section>
      <div
        ref={mapRef}
        role="application"
        aria-label="雨雲レーダーの地図。ドラッグか矢印キーで動かし、プラスとマイナスで拡大縮小できます"
        tabIndex={0}
        data-no-day-swipe
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onKeyDown={onKeyDown}
        className="relative aspect-[4/3] w-full max-w-[512px] cursor-grab touch-none self-center overflow-hidden rounded-[10px] border border-border bg-border active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-accent"
      >
        <div
          className="absolute top-1/2 left-1/2"
          style={{
            width: innerWidth,
            height: innerHeight,
            transform: `translate(-50%, -50%) scale(${scale})`,
          }}
        >
          <div className="absolute inset-0 dark:[filter:invert(1)_hue-rotate(180deg)_brightness(0.82)_contrast(0.9)]">
            {tiles.map((tile) => (
              <TileImage key={`${tileZoom}/${tile.x}/${tile.y}`} src={baseTileUrl(tileZoom, tile)} tile={tile} onDone={() => {}} />
            ))}
          </div>
          {layers.map((frame) => (
            <div
              key={frame.validtime}
              className="absolute inset-0 opacity-0 data-[shown=true]:opacity-80"
              data-shown={frame.validtime === shownTime}
            >
              {tiles.map((tile) => {
                const url = rainTileUrl(frame, tileZoom, tile);
                return (
                  <TileImage
                    key={url}
                    src={url}
                    tile={tile}
                    onDone={() => markSettled(url)}
                    onFailed={() => setFailed((prev) => new Set(prev).add(url))}
                  />
                );
              })}
            </div>
          ))}
        </div>
        {markerVisible && (
          <span
            aria-label={centerLabel}
            className="absolute top-1/2 left-1/2 size-3.5 rounded-full border-[2.5px] border-white bg-accent shadow-[0_0_0_1px_rgba(0,0,0,0.25),0_1px_4px_rgba(0,0,0,0.4)]"
            style={{ transform: `translate(calc(-50% + ${markerOffset.x}px), calc(-50% + ${markerOffset.y}px))` }}
          />
        )}
        <span
          className={cn(
            "absolute top-2 left-2 rounded-lg px-2 py-0.5 text-xs font-bold tabular-nums text-white",
            current.kind === "forecast" ? "bg-[#c8503c]/90" : "bg-slate-900/80",
          )}
        >
          {frameLabel(current)}
        </span>
        <span className="absolute top-2 right-2 rounded-lg bg-slate-900/80 px-2 py-0.5 text-xs tabular-nums text-white">
          {scaleLabel(viewWidthKm(centerLat, zoom, size.width))}
        </span>
        {moved && (
          <button
            type="button"
            onClick={resetView}
            className="absolute bottom-2 left-2 inline-flex h-9 items-center gap-1 rounded-[10px] bg-white/95 px-3 text-[0.8125rem] font-semibold text-slate-700 shadow-[0_1px_3px_rgba(0,0,0,0.25)] focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Crosshair className="size-3.5" aria-hidden="true" />
            選択地点へ戻す
          </button>
        )}
        <div className="absolute right-2 bottom-2 flex flex-col gap-1.5">
          {(
            [
              [0.5, "拡大", Plus, zoom >= RADAR_ZOOM_MAX],
              [-0.5, "縮小", Minus, zoom <= RADAR_ZOOM_MIN],
            ] as const
          ).map(([delta, label, Icon, disabled]) => (
            <button
              key={label}
              type="button"
              aria-label={label}
              disabled={disabled}
              onClick={() => zoomBy(delta)}
              className="grid size-11 place-items-center rounded-[10px] bg-white/95 text-slate-700 shadow-[0_1px_3px_rgba(0,0,0,0.25)] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent"
            >
              <Icon className="size-5" aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>

      {/* スライダーの横の動きで日がめくれないように、日めくりの対象から外す（day-swipe.tsx） */}
      <div className="flex items-center gap-2.5" data-no-day-swipe>
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? "停止" : "再生"}
          className="grid size-9 shrink-0 place-items-center rounded-full border border-border bg-surface text-foreground hover:bg-rail-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {playing ? <Pause className="size-3.5" aria-hidden="true" /> : <Play className="size-3.5" aria-hidden="true" />}
        </button>
        <div className="min-w-0 flex-1">
          <input
            type="range"
            min={0}
            max={lastIndex}
            step={1}
            value={index}
            aria-label="表示する時刻"
            aria-valuetext={frameLabel(current)}
            onChange={(event) => {
              setPlaying(false);
              select(Number(event.target.value));
            }}
            className="block h-[22px] w-full accent-accent"
          />
          <div className="relative h-4 text-[0.65625rem] text-muted">
            {nowIndex > 0 && <span className="absolute left-0">1時間前</span>}
            <span
              className="absolute -translate-x-1/2 font-bold text-accent"
              style={{ left: `${lastIndex === 0 ? 100 : (nowIndex / lastIndex) * 100}%` }}
            >
              今
            </span>
            {nowIndex < lastIndex && (
              <span className="absolute right-0">{Math.max(1, hoursAfter(frames[nowIndex], frames[lastIndex]))}時間後</span>
            )}
          </div>
        </div>
      </div>

      {currentFailed && (
        <p role="status" className="text-xs text-danger">
          この時刻の雨雲を一部取得できませんでした。雨雲が無いとは限りません。
        </p>
      )}
      {hasForecast && !hasLongRange && (
        <p className="text-xs text-danger">1時間より先の予報を取得できなかったので、1時間先までを出しています。</p>
      )}
      {!hasForecast && <p className="text-xs text-danger">予報を取得できなかったので、今までの実況だけを出しています。</p>}

      <div className="flex flex-wrap items-center gap-x-[3px] gap-y-0.5 text-[0.65625rem] text-muted">
        <span className="mr-0.5">mm/h</span>
        {LEGEND.map((item) => (
          <span key={item.label} className="ml-1 inline-flex items-center gap-[3px]">
            <i className="inline-block h-[9px] w-3.5 rounded-[2px]" style={{ background: item.color }} aria-hidden="true" />
            {item.label}
          </span>
        ))}
      </div>
      <p className="text-[0.6875rem] text-muted">雨雲: 気象庁 高解像度降水ナウキャスト・降水短時間予報（1時間より先）／地図: 地理院タイル</p>
    </Section>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-2 flex flex-col gap-[7px] border-t border-border pt-2.5">
      <h4 className="flex justify-between gap-2 text-xs font-bold tracking-[0.06em] text-muted">
        雨雲レーダー <span className="font-normal tracking-normal">周辺の降り方</span>
      </h4>
      {children}
    </div>
  );
}
