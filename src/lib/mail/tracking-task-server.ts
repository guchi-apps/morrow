import { callTaskMemoWriteToolJson, callToolJson, connectedServerFor, type ToolJson } from "@/lib/mcp/direct-call";
import type { ConnectedServer } from "@/lib/mcp/connections";

import { getMail, type MailUser } from "@/lib/mail/aide-client";
import type { MailFailureKind } from "@/lib/mail/contract";
import { addMailLink } from "@/lib/mail/link";
import type { TrackingFields } from "@/lib/mail/tracking-link";
import { appendTrackingMemo, memoHasTrackingNumber, parseTaskSnapshot, TASK_MEMO_MAX, type TaskSnapshot } from "@/lib/mail/tracking-task";

/**
 * 追跡番号を既存タスクのメモへ書き足す（#1211）。**サーバー専用。** 利用者がシートで押したときだけ呼ぶ。
 *
 * - **先に `getMail()` で持ち主を照合する**（#683）
 * - 毎回タスクを読み直し、同じ番号があれば足さない。書くのは `taskId`・`version`・`memo` だけ（版が変わっていれば書かれない）
 * - `aide_update_task` に冪等キーの口は無い。結果が分からない回は読み直して確かめる
 * - メモ・番号はログに出さない
 */

export type TrackingTaskOutcome =
  | { ok: true; status: "done" | "duplicate"; message: string }
  | { ok: false; kind: MailFailureKind | "unconfigured" | "invalid" | "conflict" | "failed"; message: string };

async function readTask(server: ConnectedServer, taskId: string): Promise<TaskSnapshot | null> {
  try {
    return parseTaskSnapshot(await callToolJson(server, "aide_get_task", { taskId }));
  } catch (error) {
    console.error("[aide-bot] 追跡番号の追記先のタスクを読めなかった", error instanceof Error ? error.message : error);
    return null;
  }
}

export async function appendTrackingToTask(user: MailUser, messageId: string, taskId: string, tracking: TrackingFields): Promise<TrackingTaskOutcome> {
  const mail = await getMail(user, messageId);
  if (!mail.ok) return { ok: false, kind: mail.kind, message: mail.message ?? "メールを読めませんでした。" };

  const server = await connectedServerFor(user.id, "aide");
  if (!server) return { ok: false, kind: "unconfigured", message: "AIDEが接続されていません。設定の接続から繋いでください。" };

  const task = await readTask(server, taskId);
  if (!task) return { ok: false, kind: "failed", message: "タスクを読めなかったため、追記しませんでした。時間をおいて試してください。" };
  if (task.status !== "open") return { ok: false, kind: "invalid", message: "このタスクは完了しているため、追記しませんでした。" };

  // このメールにも紐づける（#834）。保存の失敗は本筋を止めない
  const link = () =>
    addMailLink(user.id, messageId, { kind: "task", targetId: taskId, calendarId: null, title: task.title, dateText: task.due ?? task.planned }, "manual");

  const next = appendTrackingMemo(task.memo, tracking);
  if (next.status === "too_long") return { ok: false, kind: "invalid", message: `メモが${TASK_MEMO_MAX}字を超えるため、追記しませんでした。` };
  if (next.status === "duplicate") {
    await link();
    return { ok: true, status: "duplicate", message: `「${task.title}」のメモには、この追跡番号がすでにあります。このメールに紐づけました。` };
  }

  let written: ToolJson | null = null;
  try {
    written = await callTaskMemoWriteToolJson(server, "aide_update_task", { taskId, version: task.version, memo: next.memo });
  } catch (error) {
    console.error("[aide-bot] 追跡番号の追記に失敗した", error instanceof Error ? error.message : error);
  }
  if (written?.ok === false && written.kind === "conflict") {
    return { ok: false, kind: "conflict", message: "タスクがほかで変更されたため、追記しませんでした。もう一度押してください。" };
  }
  const saved = parseTaskSnapshot(written) ?? (await readTask(server, taskId));
  if (!saved || !memoHasTrackingNumber(saved.memo ?? "", tracking.number)) {
    return { ok: false, kind: "failed", message: "追記できたことを確認できませんでした。タスクを確かめてから、もう一度押してください。" };
  }
  await link();
  return { ok: true, status: "done", message: `「${task.title}」のメモに追跡番号を追記し、このメールに紐づけました。` };
}
