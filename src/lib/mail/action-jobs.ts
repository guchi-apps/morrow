/**
 * メールの整理操作を、利用者ごとに1つずつサーバーで流す（#1192）。
 *
 * 順番待ちをブラウザに置くと、アプリを閉じた時点で未送信の分が止まる。画面は押した瞬間にすべて送り、
 * 列はサーバーが持つ（AIDEへの重なりを避ける理由は#767と同じ。新着確認の自動アーカイブも同じ列を通す）。
 *
 * `submit()` は完了を待たずに状態を返す。同じ `opId` の再送は実行中なら相乗り、終わっていれば（成否とも）
 * 覚えた結果を返し、二度実行しない。控えはプロセス内だけで、再起動で消える。
 */

export type JobState<T> = { state: "running" } | { state: "done"; value: T };

export const ACTION_JOB_TTL_MS = 10 * 60 * 1000;

type Job<T> = { settled: { value: T } | null; finishedAt: number };

export function createActionJobs<T>(options: { ttlMs?: number; now?: () => number } = {}) {
  const ttlMs = options.ttlMs ?? ACTION_JOB_TTL_MS;
  const now = options.now ?? Date.now;
  const chains = new Map<string, Promise<unknown>>();
  const jobs = new Map<string, Job<T>>();

  /** 利用者の列の最後に足す。前の操作が失敗していても次は流す。 */
  function run(userId: string, task: () => Promise<T>): Promise<T> {
    const result = (chains.get(userId) ?? Promise.resolve()).then(task, task);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    chains.set(userId, tail);
    void tail.then(() => {
      if (chains.get(userId) === tail) chains.delete(userId);
    });
    return result;
  }

  function submit(userId: string, opId: string, task: () => Promise<T>): JobState<T> {
    for (const [key, job] of jobs) {
      if (job.settled && now() - job.finishedAt >= ttlMs) jobs.delete(key);
    }
    const key = `${userId}\n${opId}`;
    const known = jobs.get(key);
    if (known) return known.settled ? { state: "done", value: known.settled.value } : { state: "running" };
    const job: Job<T> = { settled: null, finishedAt: 0 };
    jobs.set(key, job);
    run(userId, task).then(
      (value) => {
        job.settled = { value };
        job.finishedAt = now();
      },
      // 想定外の例外は覚えない（再送でやり直せる）
      () => jobs.delete(key),
    );
    return { state: "running" };
  }

  return { run, submit };
}
