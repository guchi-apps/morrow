/**
 * 会話一覧の表示用の整形（#1156。純粋）。
 */

export function sessionLabel(title: string | null): string {
  return title && title.trim() !== "" ? title : "（題名なし）";
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 日本時間で「今日 21:40」「昨日 21:40」「11月20日」。最終更新が分からなければ空。 */
export function lastActiveLabel(at: number | null, now: number): string {
  if (at === null) return "";
  const jst = (ms: number) => new Date(ms + 9 * 60 * 60 * 1000);
  const day = (ms: number) => Math.floor((ms + 9 * 60 * 60 * 1000) / DAY_MS);
  const d = jst(at);
  const hhmm = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  const diff = day(now) - day(at);
  if (diff <= 0) return `今日 ${hhmm}`;
  if (diff === 1) return `昨日 ${hhmm}`;
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
}
