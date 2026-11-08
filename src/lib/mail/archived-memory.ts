/**
 * アーカイブに成功したメールを、短時間だけブラウザに覚える（#795）。
 *
 * アーカイブ直後に一覧を取り直しても、Gmailの反映遅れで古い一覧（まだINBOX付き）が返ることがある。
 * そのとき受信トレイへ再び出さないよう、画面側でも「アーカイブ済み」を覚えて隠す。
 * 台帳（メール）の状態の複製ではなく、押した操作の短い控え（IDと時刻だけ。2分で消える）。
 * 純粋な部分（期限・追加・削除・絞り込み）だけここに置き、保存先は呼び出し側から渡す。
 */

export const ARCHIVED_TTL_MS = 2 * 60 * 1000;

/** メールID → アーカイブに成功した時刻（ms） */
export type ArchivedMap = Record<string, number>;

export function pruneArchived(map: ArchivedMap, nowMs: number): ArchivedMap {
  const next: ArchivedMap = {};
  for (const [id, at] of Object.entries(map)) {
    if (typeof at === "number" && nowMs - at < ARCHIVED_TTL_MS && nowMs - at >= 0) next[id] = at;
  }
  return next;
}

export function addArchived(map: ArchivedMap, ids: string[], nowMs: number): ArchivedMap {
  const next = pruneArchived(map, nowMs);
  for (const id of ids) next[id] = nowMs;
  return next;
}

export function removeArchived(map: ArchivedMap, ids: string[], nowMs: number): ArchivedMap {
  const next = pruneArchived(map, nowMs);
  for (const id of ids) delete next[id];
  return next;
}

/** 受信トレイ表示のときだけ、覚えにあるメールを一覧から外す。`map` は読み込み時に期限を除いてある前提。 */
export function hideArchived<T extends { id: string }>(rows: T[], map: ArchivedMap, inboxView: boolean): T[] {
  if (!inboxView) return rows;
  return rows.filter((row) => !(row.id in map));
}

/** 受信トレイ表示では、INBOXラベルの無いメール（アーカイブ済み）を出さない。 */
export function onlyInbox<T extends { labelIds: string[] }>(rows: T[]): T[] {
  return rows.filter((row) => row.labelIds.includes("INBOX"));
}

// ---- ブラウザ側の保存（sessionStorage。読み書きの失敗は握りつぶす） ----

const KEY = "morrow:mail-archived";
const listeners = new Set<() => void>();

export function readArchived(nowMs: number = Date.now()): ArchivedMap {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return pruneArchived(parsed as ArchivedMap, nowMs);
  } catch {
    return {};
  }
}

function write(map: ArchivedMap) {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // 保存できなくても本筋は止めない
  }
  listeners.forEach((l) => l());
}

export function rememberArchived(ids: string[]) {
  write(addArchived(readArchived(), ids, Date.now()));
}

export function forgetArchived(ids: string[]) {
  write(removeArchived(readArchived(), ids, Date.now()));
}

export function subscribeArchived(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
