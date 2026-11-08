import { dashboardWeather } from "@/lib/dashboard/aide";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** 日本時間の「11月8日(日)」。 */
function jstDateLabel(now: Date): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.getUTCMonth() + 1}月${jst.getUTCDate()}日(${WEEKDAYS[jst.getUTCDay()]})`;
}

/**
 * メニュー上部の情報カード（#719）。日付と今日の天気のひとこと。
 * 親指の届きにくい上側には押すものを置かず、見るだけの情報を出す。
 * 天気はダッシュボードと同じキャッシュ（`dashboardWeather()`）を通るので、AIDEへの呼び出しは増えない。
 * 取れないとき・未接続のときは天気の行を出さず、日付だけにする（エラー表示にはしない）。
 */
export async function MenuInfo({ userId }: { userId: string }) {
  const now = new Date();
  const weather = await dashboardWeather(userId, now);
  const today = weather.status === "ok" ? weather.today : null;

  return (
    <div className="mx-4 rounded-[10px] border border-border bg-surface px-3 py-2.5 text-xs">
      <span className="block text-muted">{jstDateLabel(now)}</span>
      {today && (
        <>
          <b className="mt-0.5 block text-[0.8125rem] font-medium">{today.summary}</b>
          <span className="block tabular-nums text-muted">
            {today.max !== null && `最高 ${Math.round(today.max)}°`}
            {today.max !== null && today.min !== null && " / "}
            {today.min !== null && `最低 ${Math.round(today.min)}°`}
            {today.pop !== null && `・降水 ${today.pop}%`}
          </span>
        </>
      )}
    </div>
  );
}
