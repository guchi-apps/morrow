import { createActionJobs } from "@/lib/mail/action-jobs";
import { applyMailAction, type MailOutcome, type MailUser } from "@/lib/mail/aide-client";
import { deleteAnalyses } from "@/lib/mail/analysis-store";
import { forgetArchivedLog, recordArchived } from "@/lib/mail/archive-log";
import type { MailAction, MailActionResult } from "@/lib/mail/contract";
import { deleteListSummaries } from "@/lib/mail/list-summary";

/**
 * メールの整理操作1件（AIDEへの操作＋後始末）。**サーバー専用。**
 *
 * 画面の操作（`POST /api/mail/actions`）も新着確認の自動アーカイブもここを通り、利用者ごとの同じ列に並ぶ（#1192）。
 * リクエストに依存しないので、画面が閉じても最後まで走る。
 */

export type MailActionInput = { action: MailAction; ids: string[]; labelId: string | null; markRead?: boolean };

export type MailActionRun = { result: MailOutcome<MailActionResult>; markedRead: boolean };

// Route Handlerと新着確認でモジュールが分かれても、列は1つにする
const store = globalThis as typeof globalThis & { mailActionJobs?: ReturnType<typeof createActionJobs<MailActionRun>> };
const jobs = (store.mailActionJobs ??= createActionJobs<MailActionRun>());

export function runMailAction(user: MailUser, input: MailActionInput): Promise<MailActionRun> {
  return jobs.run(user.id, () => perform(user, input));
}

export function submitMailAction(user: MailUser, input: MailActionInput, opId: string) {
  return jobs.submit(user.id, opId, () => perform(user, input));
}

async function perform(user: MailUser, input: MailActionInput): Promise<MailActionRun> {
  let markedRead = false;
  try {
    const ids = [...new Set(input.ids)];
    // 「未読なら既読にしてからアーカイブ」は1件の操作にする（途中で画面が閉じてもアーカイブが抜けない）
    if (input.markRead && input.action === "archive") {
      const read = await applyMailAction(user, { action: "read", ids, labelId: null });
      if (!read.ok) return { result: read, markedRead };
      markedRead = true;
    }
    const result = await applyMailAction(user, { action: input.action, ids, labelId: input.labelId });
    if (result.ok) await cleanUp(user.id, input.action, ids);
    return { result, markedRead };
  } catch (error) {
    console.error("[aide-bot] メールの操作に失敗した", error instanceof Error ? error.message : error);
    return { result: { ok: false, kind: "failed", message: null }, markedRead };
  }
}

/** 成功した操作の後始末。失敗しても操作の成功は返す（残りは一覧・定期の掃除が拾う）。 */
async function cleanUp(userId: string, action: MailAction, ids: string[]) {
  const warn = (label: string) => (error: unknown) =>
    console.warn(`[aide-bot] ${label}に失敗した`, error instanceof Error ? error.message : error);

  // アーカイブ・ゴミ箱に移したメールの要約（#851）と保存した分析（#883）は消す
  if (action === "archive" || action === "trash") {
    await deleteListSummaries(userId, ids).catch(warn("一覧の要約の削除"));
    await deleteAnalyses(userId, ids).catch(warn("メールの分析の削除"));
  }
  // 最近のアーカイブ（#1122）。アーカイブは時刻を控え、受信トレイへ戻す・ゴミ箱へ移すと控えを消す
  if (action === "archive") await recordArchived(userId, ids).catch(warn("アーカイブの控えの保存"));
  else if (action === "inbox" || action === "trash") await forgetArchivedLog(userId, ids).catch(warn("アーカイブの控えの削除"));
}
