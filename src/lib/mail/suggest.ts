import { callToolJson, callWriteToolJson, connectedServerFor, McpCallError } from "@/lib/mcp/direct-call";

import { applyMailAction, getMail, listMail, type MailUser } from "@/lib/mail/aide-client";
import type { MailFailureKind } from "@/lib/mail/contract";
import { recordStatusOf } from "@/lib/mail/flow-record-core";
import { saveFlowRecord } from "@/lib/mail/flow-record";
import {
  findExistingEvent,
  readToolOutcome,
  toolCallFor,
  type FlowOutcome,
  type Suggestion,
} from "@/lib/mail/suggest-core";

/**
 * メールの提案（#689）。**サーバー専用。**
 *
 * `applyFlow()`: 利用者が承認した1件をAIDEのMCP（名指しの3本）で実行する。候補を作るのは `analyze.ts`（#766。要約と1回にまとめた）。
 *
 * **先に `getMail()` で持ち主を照合する**（#683）。件名・本文・値はログに出さない。
 */

/** 処理を終えたメールに付ける、利用者が作ったラベルの名前（無ければ付けない。自動では作らない）。 */
export const DONE_LABEL_NAME = "処理済み";

/** 予定の作成を実行中の鍵（利用者×メール×内容）。確認→作成の間に同じ要求が重ならないようにする。 */
const applying = new Set<string>();

export type ApplyOutcome =
  | { ok: true; outcome: FlowOutcome; labeled: boolean }
  | { ok: false; kind: MailFailureKind | "failed" | "unconfigured" | "invalid"; message: string };

export async function applyFlow(user: MailUser, messageId: string, suggestion: Suggestion): Promise<ApplyOutcome> {
  // 持ち主の照合（本人のメールだけを流す）
  const mail = await getMail(user, messageId);
  if (!mail.ok) return { ok: false, kind: mail.kind, message: mail.message ?? "メールを読めませんでした。" };
  const { message } = mail.value;

  const call = toolCallFor(suggestion, { messageId, subject: message.subject, from: message.from, receivedAt: message.receivedAt }, user.id);
  if (!call.ok) return { ok: false, kind: "invalid", message: call.reason };

  const server = await connectedServerFor(user.id, "aide");
  if (!server) return { ok: false, kind: "unconfigured", message: "AIDEが接続されていません。設定の接続から繋いでください。" };

  let outcome: FlowOutcome;
  const lockKey = call.tool === "aide_create_event" ? `${user.id}\n${messageId}\n${JSON.stringify(call.args)}` : null;
  if (lockKey) {
    if (applying.has(lockKey)) return { ok: false, kind: "failed", message: "同じ予定を登録しています。少し待ってください。" };
    applying.add(lockKey);
  }
  try {
    if (call.tool === "aide_create_event") {
      // 予定には冪等キーが無いので、作る前に同じ日の既存予定と突き合わせる（応答を取りこぼした後の再試行で増やさない）
      let existing: ReturnType<typeof findExistingEvent> = "unreadable";
      try {
        existing = findExistingEvent(await callToolJson(server, "aide_schedule", { date: call.args.date, days: 1 }), call.args);
      } catch (error) {
        console.error("[aide-bot] 予定の重複確認に失敗した", error instanceof Error ? error.message : error);
      }
      if (existing === "unreadable") {
        return { ok: false, kind: "failed", message: "同じ予定がすでにあるか確認できなかったため、登録しませんでした。時間をおいて試してください。" };
      }
      if (existing === "exists") {
        outcome = { status: "duplicate", message: "同じ予定が登録済みです。" };
      } else {
        outcome = readToolOutcome(suggestion.kind, await callWriteToolJson(server, call.tool, call.args));
      }
    } else {
      outcome = readToolOutcome(suggestion.kind, await callWriteToolJson(server, call.tool, call.args));
    }
  } catch (error) {
    console.error(`[aide-bot] メールの処理（${call.tool}）に失敗した`, error instanceof Error ? error.message : error);
    // 道具が返した短い理由（`reason`）があれば添える。本文・スタックは出さない
    const reason = error instanceof McpCallError && error.reason ? `（${error.reason}）` : "";
    if (reason && call.tool !== "aide_create_event") {
      return { ok: false, kind: "failed", message: `${suggestion.kind === "payment" ? "取り込めませんでした" : "タスクを作れませんでした"}${reason}。` };
    }
    return { ok: false, kind: "failed", message: call.tool === "aide_create_event" ? "実行できませんでした。予定は登録済みの可能性があります。確認してから試してください。" : "実行できませんでした。時間をおいて試してください。" };
  } finally {
    if (lockKey) applying.delete(lockKey);
  }
  if (outcome.status === "failed") return { ok: true, outcome, labeled: false };

  // 登録した内容の控え（#750）。失敗しても本筋は止めない
  const recordStatus = recordStatusOf(outcome);
  if (recordStatus) await saveFlowRecord(user.id, messageId, suggestion, recordStatus);

  return { ok: true, outcome, labeled: await markDone(user, messageId, message.labelIds) };
}

/** 利用者の「処理済み」ラベルがあれば付ける。無い・付けられないときは黙って何もしない。 */
async function markDone(user: MailUser, messageId: string, attached: string[]): Promise<boolean> {
  try {
    const page = await listMail(user, {});
    if (!page.ok) return false;
    const label = page.value.labels.find((l) => l.type === "user" && l.name === DONE_LABEL_NAME);
    if (!label || attached.includes(label.id)) return false;
    const done = await applyMailAction(user, { action: "label-add", ids: [messageId], labelId: label.id });
    return done.ok;
  } catch {
    return false;
  }
}
