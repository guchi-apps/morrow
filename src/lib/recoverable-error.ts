/**
 * 画面のエラー境界（`(chat)/error.tsx`・`global-error.tsx`）が、自動で読み込み直してよい例外かを決める（#863）。
 * クライアントからimportするので、サーバー専用の依存を持ち込まない。
 *
 * iOSでアプリが裏へ回ると通信が切られ、RSCの取得（`router.refresh()`・画面遷移）のストリームが途中で切れる。
 * fetch自体が失敗した回はNext.jsが通常の再読み込みへ逃がすが、ヘッダーが届いた後に切れた回は描画時の例外になり、
 * エラー境界まで上がる。読み込み直せば元の画面へ戻れる種類なので、ここで見分ける。
 */

/** 通信が途切れた・チャンクが取れなかったときの文言（Safari・Chrome・Firefox・React Flight・webpack/turbopack）。 */
const NETWORK_PATTERNS = [
  /connection closed/i,
  /load failed/i,
  /failed to fetch/i,
  /network ?error/i,
  /network connection was lost/i,
  /networkerror when attempting to fetch/i,
  /the internet connection appears to be offline/i,
  /loading (css )?chunk .* failed/i,
  /failed to load chunk/i,
  /importing a module script failed/i,
  /error loading dynamically imported module/i,
];

type ErrorLike = { name?: unknown; message?: unknown; digest?: unknown };

/**
 * 読み込み直せば直る見込みの例外か。サーバーで起きた例外（`digest` 付き）は、読み込み直しても同じ結果になるので対象外。
 */
export function isRecoverableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { name, message, digest } = error as ErrorLike;
  if (typeof digest === "string" && digest !== "") return false;
  if (name === "ChunkLoadError") return true;
  if (typeof message !== "string") return false;
  return NETWORK_PATTERNS.some((pattern) => pattern.test(message));
}

/** 同じURLを自動で読み込み直す間隔。これより短い間に同じURLで再び起きたら、ボタンの画面で止める（ループさせない）。 */
export const AUTO_RELOAD_INTERVAL_MS = 30_000;

export type ReloadMark = { url: string; at: number };

/** 前回の自動再読み込みの印から、今回も自動で読み込み直してよいかを決める。 */
export function canAutoReload(previous: ReloadMark | null, url: string, now: number): boolean {
  if (!previous || previous.url !== url) return true;
  return now - previous.at >= AUTO_RELOAD_INTERVAL_MS || now < previous.at;
}

/** sessionStorageに置いた印を読む。形が違えば無かったことにする。 */
export function parseReloadMark(raw: string | null): ReloadMark | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (value && typeof value === "object" && typeof (value as ReloadMark).url === "string" && typeof (value as ReloadMark).at === "number") {
      return { url: (value as ReloadMark).url, at: (value as ReloadMark).at };
    }
  } catch {
    // 読めない値は無視する
  }
  return null;
}
