/**
 * メール本文の短期キャッシュ（#1185。純粋なロジック。AIDEには触れない）。
 *
 * メールを開くたびにAIDEから本文を取ると数秒かかり、その間にiOSで別アプリへ移ると通信が切れて
 * 「通信が途切れました」になる。画面の表示（と先読み）だけ、利用者×メールIDでプロセス内に持つ。
 * - **画面表示用だけ。** 整理操作の事前の持ち主照合・添付・分析などは使わず、毎回AIDEから取る（#683）
 * - 持ち主の照合は返すたびに呼び出し側が行う（保存するのはAIDEの応答そのもの＝`owner` つき）
 * - 整理操作の成功時は `forgetMailBodies()` で該当IDを破棄する（既読・ラベルが変わるため）
 * - メモリのみ。DB・ログには残さない。再起動で消える。上限 `MAX_ENTRIES` 件
 */

export const MAIL_BODY_TTL_MS = 10 * 60_000;
export const MAIL_BODY_MAX_ENTRIES = 100;

type Entry = { value: unknown; at: number };

// Next.jsはページとRoute Handlerで別のモジュールを持つことがあるので、globalThisに置く
const globalKey = "__morrowMailBodyCache";
function store(): Map<string, Entry> {
  const g = globalThis as unknown as Record<string, Map<string, Entry> | undefined>;
  return (g[globalKey] ??= new Map());
}

export function mailBodyKey(userId: string, id: string): string {
  return `${userId}\u0000${id}`;
}

export function readMailBody<T>(userId: string, id: string, now: number = Date.now()): T | null {
  const s = store();
  const key = mailBodyKey(userId, id);
  const hit = s.get(key);
  if (!hit) return null;
  if (now - hit.at >= MAIL_BODY_TTL_MS) {
    s.delete(key);
    return null;
  }
  return hit.value as T;
}

export function writeMailBody(userId: string, id: string, value: unknown, now: number = Date.now()): void {
  const s = store();
  const key = mailBodyKey(userId, id);
  s.delete(key);
  if (s.size >= MAIL_BODY_MAX_ENTRIES) s.delete(s.keys().next().value as string);
  s.set(key, { value, at: now });
}

export function forgetMailBodies(userId: string, ids: string[]): void {
  const s = store();
  for (const id of ids) s.delete(mailBodyKey(userId, id));
}

/** その利用者の本文をすべて捨てる。 */
export function forgetAllMailBodies(userId: string): void {
  const s = store();
  for (const key of [...s.keys()]) if (key.startsWith(`${userId}\u0000`)) s.delete(key);
}

/** テスト用。 */
export function resetMailBodyCache(): void {
  store().clear();
}
