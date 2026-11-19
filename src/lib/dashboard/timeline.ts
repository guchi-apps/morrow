/**
 * 予定カードのタイムライン配置（#1089）。縦が時間軸で、予定・記録それぞれの時間を縦線で示し、
 * 右の項目名と折れ線でつなぐ。ここは配置の計算だけ（DBにもネットワークにも触れない。`test/dashboard-timeline.test.ts`）。
 *
 * - 時間軸に載せるのは、時刻のある予定（`event`）・移動（`travel`）と記録。時刻なし・タスク・リマインドは
 *   時間軸の上の帯（`band`）へ回す
 * - 予定と記録は同じ軸に混ぜて並べる（線の列は重なる時間だけ増える）。区別は色（呼び出し側）
 * - 範囲は時刻のある項目の前後1時間（最低 7〜22時）。0〜24時に収める
 */

export const HOUR_PX = 44;
/** 項目名どうしの縦の最小間隔。 */
export const LABEL_STEP_PX = 24;
const DEFAULT_START_HOUR = 7;
const DEFAULT_END_HOUR = 22;
const MIN_BAR_MINUTES = 15;

export type TimelineInput = {
  kind: "event" | "travel" | "reminder" | "task";
  start: string | null;
  end: string | null;
  record: boolean;
};

export type TimelineBar = {
  /** 入力配列でのindex。 */
  index: number;
  lane: number;
  /** 軸の上端からの px。 */
  top: number;
  bottom: number;
  /** 項目名の上端（線の開始位置から、重ならないよう下へ送った値）。 */
  labelTop: number;
};

export type TimelineLayout = {
  startHour: number;
  endHour: number;
  height: number;
  laneCount: number;
  bars: TimelineBar[];
  /** 時間軸に載せない項目（時刻なし・タスク・リマインド）のindex。 */
  band: number[];
};

/** `HH:MM` → 分。読めなければnull。 */
export function toMinutes(value: string | null): number | null {
  if (value === null) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes <= 24 * 60 ? minutes : null;
}

/** 開始・終了（分）。終了なし・開始以前（日をまたぐ）は、短い線か当日の終わりまでに丸める。 */
function span(item: TimelineInput): { start: number; end: number } | null {
  if (item.kind !== "event" && item.kind !== "travel") return null;
  const start = toMinutes(item.start);
  if (start === null) return null;
  const rawEnd = toMinutes(item.end);
  let end: number;
  if (rawEnd === null) end = start + MIN_BAR_MINUTES;
  else if (rawEnd <= start) end = rawEnd < start ? 24 * 60 : start + MIN_BAR_MINUTES; // 日をまたぐ予定は当日の終わりまで
  else end = rawEnd;
  return { start, end: Math.min(end, 24 * 60) };
}

export function layoutTimeline(items: TimelineInput[]): TimelineLayout {
  const timed: { index: number; start: number; end: number }[] = [];
  const band: number[] = [];
  items.forEach((item, index) => {
    const s = span(item);
    if (s) timed.push({ index, ...s });
    else band.push(index);
  });

  let startHour = DEFAULT_START_HOUR;
  let endHour = DEFAULT_END_HOUR;
  for (const t of timed) {
    startHour = Math.min(startHour, Math.floor(t.start / 60) - 1);
    endHour = Math.max(endHour, Math.ceil(t.end / 60) + 1);
  }
  startHour = Math.max(0, startHour);
  endHour = Math.min(24, endHour);
  const height = (endHour - startHour) * HOUR_PX;
  const px = (minutes: number) => ((minutes - startHour * 60) / 60) * HOUR_PX;

  // 開始の早い順に、空いている最も左の列へ詰める。
  timed.sort((a, b) => a.start - b.start || a.end - b.end || a.index - b.index);
  const laneEnds: number[] = [];
  const bars: TimelineBar[] = [];
  let lastLabel = -Infinity;
  for (const t of timed) {
    let lane = laneEnds.findIndex((end) => end <= t.start);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = t.end;
    const top = px(t.start);
    const labelTop = Math.max(top, lastLabel + LABEL_STEP_PX);
    lastLabel = labelTop;
    bars.push({ index: t.index, lane, top, bottom: Math.max(px(t.end), top + 6), labelTop });
  }
  // 項目名が下へ送られて軸の外へ出ないように、高さを足す。
  const labelBottom = bars.length ? bars[bars.length - 1].labelTop + LABEL_STEP_PX : 0;
  return { startHour, endHour, height: Math.max(height, labelBottom), laneCount: laneEnds.length, bars, band };
}

/** 現在時刻の線の位置（px）。範囲外ならnull。 */
export function nowTop(layout: TimelineLayout, nowTime: string): number | null {
  const minutes = toMinutes(nowTime);
  if (minutes === null) return null;
  if (minutes < layout.startHour * 60 || minutes > layout.endHour * 60) return null;
  return ((minutes - layout.startHour * 60) / 60) * HOUR_PX;
}
