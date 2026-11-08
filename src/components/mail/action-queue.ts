/**
 * メールの整理操作を1通ずつ順番に流すキュー（#767）。
 *
 * 連続スワイプで「事前照合→操作→一覧の再取得」が同時にAIDEへ飛ぶと、重なりで断られて赤い帯が出た。
 * 画面の中で1本の列にして、前の操作が終わってから次を送る。`pending()` は待ち・実行中の合計。
 */
export function createSerialQueue() {
  let chain: Promise<unknown> = Promise.resolve();
  let count = 0;
  const listeners = new Set<(count: number) => void>();
  const emit = () => listeners.forEach((l) => l(count));

  return {
    /** 列の最後に足す。前の操作が失敗していても次は流す。 */
    enqueue<T>(task: () => Promise<T>): Promise<T> {
      count += 1;
      emit();
      const run = chain.then(task, task);
      chain = run.catch(() => undefined);
      return run.finally(() => {
        count -= 1;
        emit();
      });
    },
    pending: () => count,
    subscribe(listener: (count: number) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
