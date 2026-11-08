/** メール画面の日時の出し方（#683）。日本時間で、今日は時刻・昨日は「昨日」・それ以前は月/日。 */

const dayFormat = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" });
const timeFormat = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });
const mdFormat = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" });
const fullFormat = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function mailTimeLabel(at: number | null, now: Date): string {
  if (at === null) return "";
  const date = new Date(at);
  const today = dayFormat.format(now);
  if (dayFormat.format(date) === today) return timeFormat.format(date);
  if (dayFormat.format(new Date(at + 24 * 60 * 60 * 1000)) === today) return "昨日";
  return mdFormat.format(date);
}

export function mailFullTime(at: number | null): string {
  return at === null ? "不明" : fullFormat.format(new Date(at));
}

export function elapsedLabel(at: Date, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - at.getTime()) / 60000));
  if (minutes < 1) return "たった今";
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  return `${Math.round(hours / 24)}日前`;
}

export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
