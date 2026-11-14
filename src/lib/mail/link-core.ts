import { RECORD_CALENDAR_NAME } from "@/lib/dashboard/schedule-phase";
import { flattenText } from "@/lib/mail/triage-core";

/**
 * メールと予定・タスクの紐づけ（#834）のうち、DB・ネットワークに触れない部分。`test/mail-link.test.ts` が固定する。
 * 紐づけは**押した操作の控え**で、台帳の記録の複製の正ではない（件名・差出人・本文は持たない。#732）。
 * クライアントからもimportするので、Prismaを持ち込まない。
 */

export const LINK_KINDS = ["event", "task"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];
export type LinkSource = "created" | "manual";

export const LINK_KIND_META: Record<LinkKind, { icon: string; label: string }> = {
  event: { icon: "📅", label: "予定" },
  task: { icon: "✅", label: "タスク" },
};

export const LINK_SOURCE_LABELS: Record<LinkSource, string> = {
  created: "メールから作成",
  manual: "あとから紐づけ",
};

const TITLE_LIMIT = 200;
const ID_LIMIT = 120;
const CALENDAR_ID_LIMIT = 200;
/** 候補の画面に出す件数の上限。 */
export const CANDIDATE_MAX = 60;

export type LinkTarget = {
  kind: LinkKind;
  targetId: string;
  calendarId: string | null;
  title: string;
  dateText: string | null;
};

/** 画面・APIが扱う、紐づけ1件。 */
export type LinkView = LinkTarget & { id: string; source: LinkSource; messageId: string };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record).filter((v): v is Record<string, unknown> => v !== null) : [];
}

function text(value: unknown, limit: number): string {
  return typeof value === "string" ? flattenText(value, limit) : "";
}

/** idは文字列か整数。印字可能な文字だけ（外から来る値）。 */
function idOf(value: unknown, limit = ID_LIMIT): string | null {
  const raw = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : typeof value === "string" ? value : "";
  if (raw === "" || raw.length > limit || /[\u0000- \u007f]/.test(raw)) return null;
  return raw;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function dateOf(value: unknown): string | null {
  return typeof value === "string" && DATE.test(value) ? value : null;
}

/** 外から来た紐づけ先（POSTの本文）を検証・正規化する。読めなければnull。 */
export function normalizeLinkTarget(body: Record<string, unknown> | null): LinkTarget | null {
  if (!body) return null;
  const kind = body.kind;
  if (kind !== "event" && kind !== "task") return null;
  const targetId = idOf(body.targetId);
  if (!targetId) return null;
  const title = text(body.title, TITLE_LIMIT);
  if (!title) return null;
  const calendarId = kind === "event" ? idOf(body.calendarId, CALENDAR_ID_LIMIT) : null;
  // 予定の変更・取り消しはid＋calendarIdで名指しする。calendarIdの無い予定の紐づけは受けない
  if (kind === "event" && !calendarId) return null;
  return { kind, targetId, calendarId, title, dateText: dateOf(body.dateText) };
}

export type LinkCandidate = LinkTarget & { time: string | null };

/** `aide_schedule` の応答から、紐づけの候補になる予定を集める（複数日。活動記録・中止は除く）。 */
export function parseEventCandidates(json: unknown): LinkCandidate[] {
  const out: LinkCandidate[] = [];
  const root = record(json);
  if (!root || root.configured === false) return out;
  for (const day of list(root.days)) {
    const date = dateOf(day.date);
    for (const event of list(day.events)) {
      const targetId = idOf(event.id);
      const calendarId = idOf(event.calendarId, CALENDAR_ID_LIMIT);
      const title = text(event.title, TITLE_LIMIT);
      if (!targetId || !calendarId || !title) continue;
      if (event.outcome === "CANCELED") continue;
      if (text(event.calendarName, 60) === RECORD_CALENDAR_NAME) continue;
      const start = typeof event.startTime === "string" && /^\d{2}:\d{2}$/.test(event.startTime) && event.allDay !== true ? event.startTime : null;
      out.push({ kind: "event", targetId, calendarId, title, dateText: date, time: start });
      if (out.length >= CANDIDATE_MAX) return out;
    }
  }
  return out;
}

export type CalendarChoice = { id: string; name: string };
const CALENDAR_CHOICE_MAX = 20;

/**
 * `aide_schedule` の応答から、予定の保存先に選べるカレンダーを集める（#908）。専用の一覧の道具が無いので、期間内の予定が持つ
 * calendarId・calendarName から作る（予定が1件も無いカレンダーは出ない）。活動記録（実績）は除く。
 */
export function parseCalendarChoices(json: unknown): CalendarChoice[] {
  const root = record(json);
  if (!root || root.configured === false) return [];
  const seen = new Map<string, string>();
  for (const day of list(root.days)) {
    for (const event of list(day.events)) {
      const id = idOf(event.calendarId, CALENDAR_ID_LIMIT);
      const name = text(event.calendarName, 60);
      if (!id || !name || name === RECORD_CALENDAR_NAME || seen.has(id)) continue;
      seen.set(id, name);
    }
  }
  return [...seen].map(([id, name]) => ({ id, name })).slice(0, CALENDAR_CHOICE_MAX);
}

/** タスクの一覧（`aide_tasks`）の配列を探す。形が少し違っても読めるよう、よくある置き場所を順に見る。 */
function taskRows(json: unknown): Record<string, unknown>[] {
  const root = record(json);
  if (!root) return [];
  for (const candidate of [root.tasks, root.items, record(root.data)?.tasks, record(root.data)?.items]) {
    const rows = list(candidate);
    if (rows.length > 0) return rows;
  }
  return [];
}

/** `aide_tasks` の応答から、紐づけの候補になるタスクを集める。 */
export function parseTaskCandidates(json: unknown): LinkCandidate[] {
  const out: LinkCandidate[] = [];
  for (const row of taskRows(json)) {
    const targetId = idOf(row.taskId) ?? idOf(row.id);
    const title = text(row.title, TITLE_LIMIT) || text(row.name, TITLE_LIMIT);
    if (!targetId || !title) continue;
    out.push({ kind: "task", targetId, calendarId: null, title, dateText: dateOf(row.due) ?? dateOf(row.planned), time: null });
    if (out.length >= CANDIDATE_MAX) break;
  }
  return out;
}

/** 作成の応答（`aide_create_event`／`aide_create_task`）から、作ったもののidを探す。無ければnull。 */
export function createdIdFrom(kind: LinkKind, json: Record<string, unknown>): { targetId: string; calendarId: string | null } | null {
  const holders = [json, record(json.event), record(json.task), record(json.data), record(json.result)].filter((h): h is Record<string, unknown> => h !== null);
  for (const holder of holders) {
    const targetId = kind === "task" ? (idOf(holder.taskId) ?? idOf(holder.id)) : (idOf(holder.eventId) ?? idOf(holder.id));
    if (!targetId) continue;
    const calendarId = kind === "event" ? (idOf(holder.calendarId, CALENDAR_ID_LIMIT) ?? idOf(json.calendarId, CALENDAR_ID_LIMIT)) : null;
    if (kind === "event" && !calendarId) continue;
    return { targetId, calendarId };
  }
  return null;
}

const norm = (v: string) => v.normalize("NFKC").replace(/\s+/g, " ").trim();

/** 作成の応答にidが無かったとき、作った予定を `aide_schedule`（作成日の1日ぶん）から探す。タイトル・時刻が一致する1件だけ採る。 */
export function findCreatedEvent(
  scheduleJson: unknown,
  args: { title?: unknown; startTime?: unknown; endTime?: unknown },
): { targetId: string; calendarId: string } | null {
  const title = typeof args.title === "string" ? norm(args.title) : "";
  const start = typeof args.startTime === "string" ? args.startTime : null;
  const root = record(scheduleJson);
  const day = root ? list(root.days)[0] : undefined;
  if (!day || !title) return null;
  const hits = list(day.events).filter((event) => {
    if (event.outcome === "CANCELED" || norm(text(event.title, TITLE_LIMIT)) !== title) return false;
    const eventStart = event.allDay === true ? null : typeof event.startTime === "string" ? event.startTime : null;
    const eventEnd = event.allDay === true ? null : typeof event.endTime === "string" ? event.endTime : null;
    return eventStart === start && eventEnd === (typeof args.endTime === "string" ? args.endTime : null);
  });
  // 同じタイトル・時刻が複数あるときは、どれが作ったものか決められないので採らない
  if (hits.length !== 1) return null;
  const targetId = idOf(hits[0].id);
  const calendarId = idOf(hits[0].calendarId, CALENDAR_ID_LIMIT);
  return targetId && calendarId ? { targetId, calendarId } : null;
}

/** 作成の応答にidが無かったとき、作ったタスクを一覧から探す。題名（と期限）が一致する1件だけ採る。 */
export function findCreatedTask(tasksJson: unknown, title: string, due: string | null): { targetId: string } | null {
  const want = norm(title);
  const hits = parseTaskCandidates(tasksJson).filter((t) => norm(t.title) === want && (due === null || t.dateText === due));
  return hits.length === 1 ? { targetId: hits[0].targetId } : null;
}

/** 紐づけ済みの対象を候補から外すための鍵。 */
export function linkKey(kind: LinkKind, targetId: string): string {
  return `${kind}:${targetId}`;
}

/** ダッシュボードの行に付ける✉の見出し（件数）。 */
export function mailBadgeLabel(count: number): string {
  return count <= 1 ? "✉" : `✉ ${count}通`;
}
