import { jstDayKey } from "@/lib/day-key";
import { chooseHomeLocation, hasPoint, type RememberedLocation } from "@/lib/dashboard/home-location-core";
import { parseWeatherLocation, type WeatherLocation } from "@/lib/dashboard/parse";
import { callToolJson, connectedServerFor, type ToolJson } from "@/lib/mcp/direct-call";

/**
 * ダッシュボードの天気・予定をAIDEから取る（#573）。**モデルは通さない**（`direct-call.ts`）。
 *
 * - **プロセス内で短くキャッシュする**（成功5分・失敗1分）。自宅の地点は滅多に変わらず、
 *   予定もDaySpanを都度引くので、開くたびに叩き直す理由が薄い。PM2で1プロセスという前提は
 *   `compact.ts` と同じ。キーには日本時間の日付を含め、日付が変わったら引き直す
 * - 同じ鍵の取得が走っている間は、その結果を共有する（2つのタブで同時に開いても1本）
 * - **例外は外へ出さない。** 取れなかった回は `failed` として画面に出す（「無い」と混ぜない）
 */

const OK_TTL_MS = 5 * 60 * 1000;
const FAILED_TTL_MS = 60 * 1000;

type Entry<T> = { value: T; expiresAt: number };

const cache = new Map<string, Entry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

export async function cached<T extends { status: string }>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key) as Entry<T> | undefined;
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const running = inFlight.get(key) as Promise<T> | undefined;
  if (running) return running;

  const promise = load()
    .then((value) => {
      // 未接続はDBを見るだけで軽く、繋いだ直後に反映したいのでキャッシュしない。
      if (value.status !== "unconnected") {
        cache.set(key, { value, expiresAt: Date.now() + (value.status === "failed" ? FAILED_TTL_MS : OK_TTL_MS) });
      }
      return value;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

function failureDetail(error: unknown): string {
  return error instanceof Error ? error.message : "不明なエラー";
}

export type HomeLocationView = { status: "unconnected" } | { status: "ok"; location: WeatherLocation | null };

/** 利用者ごとに最後に座標つきで読めた自宅の地点（プロセス内）。AIDEが止まっていても使う（#1116）。 */
const rememberedLocations = new Map<string, RememberedLocation>();

/**
 * 自宅の地点（座標・市町村名）。**予報そのものはAIDEから読まない**（#1116。Open-Meteoから直接作る）。
 * AIDEの `aide_weather` から地点だけを読み、座標つきで読めたら30日覚える。取得に失敗した回・地点の無い応答の回は
 * 覚えている地点を返す（`chooseHomeLocation()`）。失敗は例外にも「failed」にもしない——地点が無いだけで、画面は「自宅の地点が届いていません」を出す。
 */
export function homeLocation(userId: string, now = new Date()): Promise<HomeLocationView> {
  return cached(`home:${userId}:${jstDayKey(now)}`, async (): Promise<HomeLocationView> => {
    let fresh: WeatherLocation | null = null;
    try {
      const server = await connectedServerFor(userId, "aide");
      if (!server) return { status: "unconnected" };
      fresh = parseWeatherLocation(await callToolJson(server, "aide_weather"));
    } catch (error) {
      console.error("[aide-bot] 自宅の地点を取得できなかった", error);
    }
    const location = chooseHomeLocation(fresh, rememberedLocations.get(userId), Date.now());
    if (hasPoint(fresh)) rememberedLocations.set(userId, { location: fresh, at: Date.now() });
    return { status: "ok", location };
  });
}

/** 予定は3日ぶんを1回で取り、今日の予定（`parseSchedule()` は1日目だけ読む）と行き先の雨（#586）で共有する。 */
const SCHEDULE_DAYS = 3;

export type ScheduleSource =
  | { status: "unconnected" }
  | { status: "failed"; detail: string }
  | { status: "ok"; json: ToolJson };

/**
 * `offset` は表示する日の今日からのずれ（#606。0＝今日）。今日は従来どおり3日ぶん、それ以外の日は
 * その日だけを `offsetDays` で引く（明日以降の雨・明日の帯は今日の画面にしか出さないため）。
 */
export function scheduleSource(userId: string, now = new Date(), offset = 0): Promise<ScheduleSource> {
  return cached(`schedule:${userId}:${jstDayKey(now)}:${offset}`, async (): Promise<ScheduleSource> => {
    try {
      const server = await connectedServerFor(userId, "aide");
      if (!server) return { status: "unconnected" };
      // `date` は渡さない（DaySpanの設定タイムゾーンでの今日。こちらで日付を作り直さない）。前後の日は `offsetDays` でずらす。
      const args = offset === 0 ? { days: SCHEDULE_DAYS } : { days: 1, offsetDays: offset };
      return { status: "ok", json: await callToolJson(server, "aide_schedule", args) };
    } catch (error) {
      console.error("[aide-bot] ダッシュボードの予定を取得できなかった", error);
      return { status: "failed", detail: failureDetail(error) };
    }
  });
}

