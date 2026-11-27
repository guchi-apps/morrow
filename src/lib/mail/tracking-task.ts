/**
 * 追跡番号をタスクのメモに残す（#1211）うち、DB・ネットワークに触れない部分。`test/mail-tracking-task.test.ts` が固定する。
 * クライアントからもimportする（シートが書き足す内容を見せる）。
 */
import { CARRIER_LABELS, trackingBlocker, trackingUrl, type TrackingFields } from "@/lib/mail/tracking-link";

/** タスクのメモの上限（YoteiFlowの更新APIとAIDEの両方が2000字）。 */
export const TASK_MEMO_MAX = 2000;

/** メモに書く行。会社が分からなければ番号だけで、追跡ページは付けない。 */
export function trackingMemoLines(tracking: TrackingFields): string[] {
  const url = trackingUrl(tracking.carrier, tracking.number);
  return [
    `追跡番号: ${tracking.carrier ? `${CARRIER_LABELS[tracking.carrier]} ` : ""}${tracking.number}`,
    ...(url ? [`追跡ページ: ${url}`] : []),
  ];
}

/** メモに同じ追跡番号がすでにあるか（ハイフン・空白の入り方が違っても同じ番号とみなす。より長い番号の一部は数えない）。 */
export function memoHasTrackingNumber(memo: string, number: string): boolean {
  if (!/^[A-Z0-9]+$/.test(number)) return false;
  const pattern = new RegExp(`(?<![A-Z0-9])${[...number].join("[ \\-‐ー−]?")}(?![A-Z0-9])`);
  return pattern.test(memo.normalize("NFKC").toUpperCase());
}

export type MemoAppend = { status: "append"; memo: string } | { status: "duplicate" } | { status: "too_long" };

/** 今のメモの末尾へ足す。今のメモは削らない（入りきらなければ書かない）。 */
export function appendTrackingMemo(memo: string | null, tracking: TrackingFields): MemoAppend {
  const current = (memo ?? "").trimEnd();
  if (memoHasTrackingNumber(current, tracking.number)) return { status: "duplicate" };
  const next = [current, ...trackingMemoLines(tracking)].filter((line) => line !== "").join("\n");
  return next.length > TASK_MEMO_MAX ? { status: "too_long" } : { status: "append", memo: next };
}

/** 追記してよい組み合わせか（配送会社を選び、桁が合うもの）。 */
export function isAttachableTracking(tracking: TrackingFields): boolean {
  return trackingBlocker(tracking.carrier, tracking.number) === null;
}

export type TaskSnapshot = { id: string; title: string; status: string; memo: string | null; version: string; due: string | null; planned: string | null };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

const day = (value: unknown) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null);

/**
 * `aide_get_task`・`aide_update_task` の応答（`{ task: {…} }`）を読む。失敗（`{ ok: false, kind, … }`）や形の違う応答はnull。
 * `memo` の無い応答は読めないとみなす（空と取り違えて今のメモを消さない）。
 */
export function parseTaskSnapshot(json: unknown): TaskSnapshot | null {
  const task = record(record(json)?.task);
  if (!task) return null;
  const { id, title, status, memo, version } = task;
  if (typeof id !== "string" || typeof title !== "string" || typeof status !== "string" || typeof version !== "string" || version === "") return null;
  if (memo !== null && typeof memo !== "string") return null;
  return { id, title, status, memo, version, due: day(task.due), planned: day(task.planned) };
}
