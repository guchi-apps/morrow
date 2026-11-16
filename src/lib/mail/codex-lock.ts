/**
 * メールのAI（分析 #766・指示 #784・通知の学習 #833・検索 #998）で、利用者ごとにCodexを同時1件にする排他。**排他だけ**を持つ。
 *
 * 「同じメールなら走っている結果を共有する」のは分析（`analyze.ts`）の側の作りで、ここには入れない——共有すると、
 * 分析中に送った指示が分析の結果を返事として受け取る（#784の計画レビュー）。鍵には種別（`analyze`／`chat`）を含める。
 * プロセス内のメモリだけ（再起動で消える）。
 */

export type MailCodexKind = "analyze" | "chat" | "learn" | "list_summary" | "search";
export type MailCodexHold = { kind: MailCodexKind; key: string };

const holds = new Map<string, MailCodexHold>();

/** いま走っているもの（無ければnull）。 */
export function currentMailCodex(userId: string): MailCodexHold | null {
  return holds.get(userId) ?? null;
}

/** 取れたら解放の関数を返す。別の実行が走っていればnull。 */
export function acquireMailCodex(userId: string, hold: MailCodexHold): (() => void) | null {
  if (holds.has(userId)) return null;
  holds.set(userId, hold);
  return () => {
    if (holds.get(userId) === hold) holds.delete(userId);
  };
}

// 利用者の操作（検索 #998）がCodexの空きを待っている印。先回りの分析（#883・#895）は、この印を見たら次の1通へ進まずに譲る
// （先回りは1通ごとに解放してすぐ取り直すので、待つ側が取れないまま時間切れになる）
const waiting = new Map<string, number>();

/** 待ち始め（戻りの関数で待ち終わり）。 */
export function waitForMailCodex(userId: string): () => void {
  waiting.set(userId, (waiting.get(userId) ?? 0) + 1);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const left = (waiting.get(userId) ?? 1) - 1;
    if (left > 0) waiting.set(userId, left);
    else waiting.delete(userId);
  };
}

/** 利用者の操作がCodexの空きを待っているか。 */
export function someoneWaitsForMailCodex(userId: string): boolean {
  return (waiting.get(userId) ?? 0) > 0;
}
