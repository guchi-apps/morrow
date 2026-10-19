import { jstDayKey } from "@/lib/day-key";
import { parseSchedule, parseWeather, type ScheduleView, type WeatherView } from "@/lib/dashboard/parse";
import { callToolJson, connectedServerFor } from "@/lib/mcp/direct-call";

/**
 * ダッシュボードの天気・予定をAIDEから取る（#573）。**モデルは通さない**（`direct-call.ts`）。
 *
 * - **プロセス内で短くキャッシュする**（成功5分・失敗1分）。AIDEの天気は毎時の同期を読むだけ、
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

async function cached<T extends { status: string }>(key: string, load: () => Promise<T>): Promise<T> {
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

export function dashboardWeather(userId: string, now = new Date()): Promise<WeatherView> {
  return cached(`weather:${userId}:${jstDayKey(now)}`, async (): Promise<WeatherView> => {
    try {
      const server = await connectedServerFor(userId, "aide");
      if (!server) return { status: "unconnected" };
      return parseWeather(await callToolJson(server, "aide_weather"));
    } catch (error) {
      console.error("[aide-bot] ダッシュボードの天気を取得できなかった", error);
      return { status: "failed", detail: failureDetail(error) };
    }
  });
}

export function dashboardSchedule(userId: string, now = new Date()): Promise<ScheduleView> {
  return cached(`schedule:${userId}:${jstDayKey(now)}`, async (): Promise<ScheduleView> => {
    try {
      const server = await connectedServerFor(userId, "aide");
      if (!server) return { status: "unconnected" };
      // `date` は渡さない（DaySpanの設定タイムゾーンでの今日。こちらで日付を作り直さない）。
      return parseSchedule(await callToolJson(server, "aide_schedule"));
    } catch (error) {
      console.error("[aide-bot] ダッシュボードの予定を取得できなかった", error);
      return { status: "failed", detail: failureDetail(error) };
    }
  });
}
