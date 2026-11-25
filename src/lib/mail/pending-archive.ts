/**
 * 結果をまだ受け取っていないアーカイブの控え（#1192）。アプリを閉じる・通信が切れると、
 * サーバーに届いたか・終わったかが分からないので、戻ったときに同じ `opId` で問い合わせ直す。
 *
 * 持つのは `opId`・メールID・既読の要否・時刻だけ。サーバーが結果を覚えている時間（10分）を過ぎたら捨て、
 * 一覧を正とする（後から勝手にアーカイブしない）。受信トレイへ戻す・ゴミ箱へ移したメールは控えから外す。
 */

export const PENDING_ARCHIVE_TTL_MS = 10 * 60 * 1000;

export type PendingArchive = { opId: string; ids: string[]; markRead: boolean; at: number };

function isEntry(value: unknown): value is PendingArchive {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.opId === "string" &&
    typeof v.markRead === "boolean" &&
    typeof v.at === "number" &&
    Array.isArray(v.ids) &&
    v.ids.length > 0 &&
    v.ids.every((id) => typeof id === "string")
  );
}

export function prunePending(list: unknown, nowMs: number): PendingArchive[] {
  if (!Array.isArray(list)) return [];
  return list.filter(isEntry).filter((e) => nowMs - e.at >= 0 && nowMs - e.at < PENDING_ARCHIVE_TTL_MS);
}

/** 指定のメールを控えから外す。メールが無くなった控えは消す。 */
export function withoutIds(list: PendingArchive[], ids: string[]): PendingArchive[] {
  const drop = new Set(ids);
  return list
    .map((e) => ({ ...e, ids: e.ids.filter((id) => !drop.has(id)) }))
    .filter((e) => e.ids.length > 0);
}

type Storage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

const KEY = "morrow:mail-pending-archive";

/** 保存先（localStorage）が使えないときは、この画面のメモリだけで動く。 */
export function createPendingStore(storage: () => Storage, now: () => number = Date.now) {
  let memory: PendingArchive[] = [];
  let broken = false;

  function list(): PendingArchive[] {
    if (!broken) {
      try {
        memory = JSON.parse(storage().getItem(KEY) ?? "[]") as PendingArchive[];
      } catch {
        // 読めなければメモリの控えを使う
      }
    }
    return prunePending(memory, now());
  }

  function write(next: PendingArchive[]) {
    memory = next;
    try {
      storage().setItem(KEY, JSON.stringify(next));
      broken = false;
    } catch {
      broken = true;
    }
  }

  return {
    list,
    get: (opId: string) => list().find((e) => e.opId === opId) ?? null,
    add(entry: PendingArchive) {
      write([...list(), entry]);
    },
    remove(opId: string) {
      write(list().filter((e) => e.opId !== opId));
    },
    dropIds(ids: string[]) {
      write(withoutIds(list(), ids));
    },
  };
}
