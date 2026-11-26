/**
 * 一覧の取り直しを「処理中が無くなる最後のタスクの終了時に、1通でも成功していれば1回」に絞る判定（#767）。
 * 最後の1通が失敗しても、先に成功した分が一覧に反映されるようにする。
 */
export function createRefreshGate() {
  let succeeded = false;
  return {
    /** 一覧に反映すべき変更が1通でも通った。 */
    markSucceeded() {
      succeeded = true;
    },
    /** タスクの終了時に呼ぶ。`pendingCount` は自分を含む待ち件数。取り直すべきなら真を返し、印を戻す。 */
    shouldRefresh(pendingCount: number): boolean {
      if (pendingCount > 1) return false;
      const result = succeeded;
      succeeded = false;
      return result;
    },
  };
}

/**
 * 結果待ちの件数（「アーカイブ中…（残りN通）」の表示用）。
 * 順番待ちそのものはサーバーが持つ（`src/lib/mail/action-jobs.ts`。#1192）。画面は押した瞬間にすべて送る。
 */
export function createPendingCounter() {
  let count = 0;
  const listeners = new Set<(count: number) => void>();
  const emit = () => listeners.forEach((l) => l(count));

  return {
    start() {
      count += 1;
      emit();
    },
    finish() {
      count -= 1;
      emit();
    },
    pending: () => count,
    subscribe(listener: (count: number) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
