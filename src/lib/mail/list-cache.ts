/**
 * メール一覧の短期キャッシュ（#823。純粋なロジック。AIDEには触れない）。
 *
 * 本文から一覧へ戻るたびにAIDEから取り直すと遅いので、画面用の一覧だけ利用者×検索条件でプロセス内に持つ。
 * - 新鮮（FRESH_MS）なら即返す。古い（STALE_MS以内）なら即返しつつ裏で取り直す（stale-while-revalidate）
 * - **保存してよいのは成功かつ `partial` でない結果だけ。** 失敗・欠落は保存せず、古い値としても返さない
 * - 利用者ごとに世代番号を持ち、`invalidateMailList()` で進める。取得開始時と完了時で世代が違えば保存しない
 *   （操作の後に、破棄前の古い一覧が裏更新で復活しない）
 * - 返すときは `messages` を複製する（呼び出し側が代入で書き換えても共有値を壊さない）
 * - DB・ログには残さない。再起動で消える
 */

export const MAIL_LIST_FRESH_MS = 60_000;
export const MAIL_LIST_STALE_MS = 10 * 60_000;
const MAX_ENTRIES = 100;

type Page = { partial: boolean; messages: unknown[] };
type Outcome<T, F extends { ok: false } = { ok: false }> = { ok: true; value: T } | F;

type Entry<T> = { value: T; at: number; gen: number };

type Store = {
  entries: Map<string, Entry<unknown>>;
  inflight: Map<string, Promise<Outcome<unknown, { ok: false }>>>;
  generations: Map<string, number>;
};

// Next.jsはページとRoute Handlerで別のモジュールを持つことがあるので、globalThisに置く
const globalKey = "__morrowMailListCache";
function store(): Store {
  const g = globalThis as unknown as Record<string, Store | undefined>;
  return (g[globalKey] ??= { entries: new Map(), inflight: new Map(), generations: new Map() });
}

function generation(userId: string): number {
  return store().generations.get(userId) ?? 0;
}

/** その利用者の一覧キャッシュを捨てる（既読・アーカイブ・新着確認の後に呼ぶ）。 */
export function invalidateMailList(userId: string): void {
  const s = store();
  s.generations.set(userId, generation(userId) + 1);
  for (const key of [...s.entries.keys()]) if (key.startsWith(`${userId}\u0000`)) s.entries.delete(key);
  for (const key of [...s.inflight.keys()]) if (key.startsWith(`${userId}\u0000`)) s.inflight.delete(key);
}

function clone<T extends Page>(value: T): T {
  return { ...value, messages: [...value.messages] };
}

export function mailListKey(userId: string, email: string | null, query: string): string {
  return `${userId}\u0000${email ?? ""}\u0000${query}`;
}

/**
 * `fetcher` の結果を鍵ごとに共有・保存する。`userId` は世代の管理に使う。
 */
export async function cachedMailList<T extends Page, F extends { ok: false }>(
  userId: string,
  key: string,
  fetcher: () => Promise<Outcome<T, F>>,
  now: number = Date.now(),
): Promise<Outcome<T, F>> {
  const s = store();
  const hit = s.entries.get(key) as Entry<T> | undefined;
  const gen = generation(userId);
  const usable = hit && hit.gen === gen && now - hit.at < MAIL_LIST_STALE_MS;

  const refresh = (): Promise<Outcome<T, F>> => {
    const running = s.inflight.get(key) as Promise<Outcome<T, F>> | undefined;
    if (running) return running;
    const startGen = generation(userId);
    const promise = fetcher()
      .then((result) => {
        if (result.ok && !result.value.partial && generation(userId) === startGen) {
          if (s.entries.size >= MAX_ENTRIES) s.entries.delete(s.entries.keys().next().value as string);
          s.entries.set(key, { value: result.value, at: now, gen: startGen });
        }
        return result;
      })
      .finally(() => {
        if (s.inflight.get(key) === promise) s.inflight.delete(key);
      });
    s.inflight.set(key, promise);
    return promise;
  };

  if (usable) {
    if (now - hit.at >= MAIL_LIST_FRESH_MS) void refresh().catch(() => undefined);
    return { ok: true, value: clone(hit.value) };
  }
  const result = await refresh();
  return result.ok ? { ok: true, value: clone(result.value) } : result;
}

/** テスト用。 */
export function resetMailListCache(): void {
  const s = store();
  s.entries.clear();
  s.inflight.clear();
  s.generations.clear();
}
