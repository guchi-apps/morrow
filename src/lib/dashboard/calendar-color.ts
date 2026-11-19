/**
 * 予定カードの線の色（#1097）。AIDEの応答にカレンダーの色は載らないので、Morrow側で決める。
 * 活動記録は茶色に固定し、それ以外はカレンダー名から決まった色（同じ名前なら必ず同じ色）にする。
 * 値は `globals.css` の `--cal-*`（ライト・ダーク両方）。
 */

export const RECORD_CALENDAR_COLOR = "var(--cal-record)";
export const TRAVEL_COLOR = "var(--cal-travel)";
const PALETTE = ["var(--cal-1)", "var(--cal-2)", "var(--cal-3)", "var(--cal-4)", "var(--cal-5)"] as const;

export function hashIndex(text: string, size: number): number {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return h % size;
}

export function calendarColor(item: { kind: string; record: boolean; note: string | null }): string {
  if (item.record) return RECORD_CALENDAR_COLOR;
  if (item.kind === "travel") return TRAVEL_COLOR;
  if (!item.note) return PALETTE[0];
  return PALETTE[hashIndex(item.note, PALETTE.length)];
}
