/**
 * メールのAI（分析 #766・指示 #784・通知の学習 #833）で、利用者ごとにCodexを同時1件にする排他。**排他だけ**を持つ。
 *
 * 「同じメールなら走っている結果を共有する」のは分析（`analyze.ts`）の側の作りで、ここには入れない——共有すると、
 * 分析中に送った指示が分析の結果を返事として受け取る（#784の計画レビュー）。鍵には種別（`analyze`／`chat`）を含める。
 * プロセス内のメモリだけ（再起動で消える）。
 */

export type MailCodexKind = "analyze" | "chat" | "learn" | "list_summary";
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
