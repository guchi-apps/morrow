/**
 * AIDEの道具（`aide_weather`・`aide_schedule`）の応答を、ダッシュボードの型へ読み替える（#573）。
 *
 * **「取得できなかった」と「無い」を混ぜない**（#214・AIDE README）。天気は `state` が `ok` 以外なら
 * 予報が無いのであって「そういう天気」ではない。予定は `configured: false`（未設定）・
 * `complete: false`（一部取れていない）・`googleConnected: false`（未接続）を、「予定なし」と別に持つ。
 * 形の読めない応答は `failed` に倒す。DBにもネットワークにも触れない純粋なモジュール
 * （`test/dashboard-parse.test.ts`）。クライアントからは型だけをimportする。
 */

export type WeatherDay = {
  date: string;
  summary: string;
  max: number | null;
  min: number | null;
  /** 降水確率の最大（%）。 */
  pop: number | null;
};

/**
 * 予報の地点（#586）。AIDEの `aide_weather` が `location`（`name`・`latitude`・`longitude`）を返すようになってから入る。
 * それまで（項目が無い応答）はnullで、画面は市町村名を出さない。名前だけ・座標だけでも読める方を使う。
 */
export type WeatherLocation = { name: string | null; latitude: number | null; longitude: number | null };

export type WeatherView =
  | { status: "unconnected" }
  | { status: "failed"; detail: string }
  /** AIDEは答えたが予報を持っていない（`state` が `ok` 以外）。 */
  | { status: "unavailable"; reason: string | null }
  | {
      status: "ok";
      today: WeatherDay;
      tomorrow: WeatherDay | null;
      /** AIDE側の同期が止まっている（古い予報）。 */
      stale: boolean;
      attribution: string | null;
      location: WeatherLocation | null;
    };

export type ScheduleItem = {
  kind: "event" | "travel" | "reminder" | "task";
  /** `HH:MM`。終日・時刻なしはnull。 */
  start: string | null;
  end: string | null;
  title: string;
  /** 補足（カレンダー名・リマインドの種類）。 */
  note: string | null;
  /** 中止（CANCELED）・不参加（ABSENT）。通常はnull。 */
  outcome: "CANCELED" | "ABSENT" | null;
  url: string | null;
};

export type ScheduleView =
  | { status: "unconnected" }
  | { status: "failed"; detail: string }
  /** DaySpanへの接続がAIDE側で未設定。 */
  | { status: "not_configured" }
  | {
      status: "ok";
      items: ScheduleItem[];
      free: { from: string; to: string }[];
      /** 一部を取得できなかった（`complete: false`）。空でも「予定なし」とは言えない。 */
      partial: boolean;
      /** Googleカレンダーが未接続（予定が空になる）。 */
      googleDisconnected: boolean;
    };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record).filter((item): item is Record<string, unknown> => item !== null) : [];
}

const TIME = /^\d{2}:\d{2}$/;

function time(value: unknown): string | null {
  const text = str(value);
  return text && TIME.test(text) ? text : null;
}

/** リンクは http(s) の絶対URLだけ（`href` へそのまま入るため）。 */
function httpUrl(value: unknown): string | null {
  const text = str(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function weatherDay(value: unknown): WeatherDay | null {
  const day = record(value);
  if (!day) return null;
  const summary = str(day.summary);
  if (!summary) return null;
  return {
    date: str(day.date) ?? "",
    summary,
    max: num(day.temperatureMax),
    min: num(day.temperatureMin),
    pop: num(day.precipitationProbabilityMax),
  };
}

function weatherLocation(value: unknown): WeatherLocation | null {
  const location = record(value);
  if (!location) return null;
  const latitude = num(location.latitude);
  const longitude = num(location.longitude);
  const hasPoint = latitude !== null && longitude !== null && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
  const name = str(location.name);
  if (!name && !hasPoint) return null;
  return { name, latitude: hasPoint ? latitude : null, longitude: hasPoint ? longitude : null };
}

export function parseWeather(json: unknown): WeatherView {
  const root = record(json);
  if (!root) return { status: "failed", detail: "天気の応答を読めませんでした" };

  if (root.state !== "ok") {
    return { status: "unavailable", reason: str(root.reason) };
  }

  const data = record(root.data);
  const today = weatherDay(data?.today);
  if (!today) return { status: "failed", detail: "今日の予報が応答に入っていませんでした" };

  return {
    status: "ok",
    today,
    tomorrow: weatherDay(data?.tomorrow),
    stale: root.stale === true,
    attribution: str(data?.attribution),
    location: weatherLocation(root.location ?? data?.location),
  };
}

/** 並べる順: 時刻の無いもの（終日・時刻なしのタスク）が先、続いて開始時刻順。 */
function compareItems(a: ScheduleItem, b: ScheduleItem): number {
  if (a.start === b.start) return 0;
  if (a.start === null) return -1;
  if (b.start === null) return 1;
  return a.start < b.start ? -1 : 1;
}

export function parseSchedule(json: unknown): ScheduleView {
  const root = record(json);
  if (!root) return { status: "failed", detail: "予定の応答を読めませんでした" };

  if (root.configured === false) return { status: "not_configured" };

  const days = list(root.days);
  if (days.length === 0) return { status: "failed", detail: "予定の応答に日付が入っていませんでした" };
  const day = days[0];

  const items: ScheduleItem[] = [];

  for (const event of list(day.events)) {
    const title = str(event.title);
    if (!title) continue;
    const allDay = event.allDay === true;
    const outcome = event.outcome === "CANCELED" || event.outcome === "ABSENT" ? event.outcome : null;
    items.push({
      kind: "event",
      start: allDay ? null : time(event.startTime),
      end: allDay ? null : time(event.endTime),
      title,
      note: str(event.calendarName),
      outcome,
      url: httpUrl(event.url),
    });
  }

  for (const travel of list(day.travels)) {
    const title = str(travel.title);
    if (!title) continue;
    items.push({
      kind: "travel",
      start: time(travel.startTime),
      end: time(travel.endTime),
      title,
      note: null,
      outcome: null,
      url: null,
    });
  }

  for (const reminder of list(day.reminders)) {
    const title = str(reminder.title);
    if (!title) continue;
    items.push({
      kind: "reminder",
      start: time(reminder.time),
      end: null,
      title,
      note: str(reminder.category),
      outcome: null,
      url: null,
    });
  }

  for (const task of list(day.tasks)) {
    const title = str(task.title);
    if (!title) continue;
    items.push({
      kind: "task",
      start: time(task.time) ?? time(task.startTime),
      end: null,
      title,
      note: null,
      outcome: null,
      url: httpUrl(task.url),
    });
  }

  // 同じ時刻のものは元の並び（予定→移動→リマインド→タスク）を保つ（Array#sortは安定）。
  items.sort(compareItems);

  const free = list(day.freeSlots)
    .map((slot) => ({ from: time(slot.from), to: time(slot.to) }))
    .filter((slot): slot is { from: string; to: string } => slot.from !== null && slot.to !== null);

  const sources = record(root.sources);

  return {
    status: "ok",
    items,
    free,
    partial: root.complete === false,
    googleDisconnected: sources?.googleConnected === false,
  };
}
