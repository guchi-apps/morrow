import { modelFor } from "@/lib/chat-model-server";
import { runCodexRecorded } from "@/lib/codex-run";
import { db } from "@/lib/db";

import { getMail, type MailUser } from "@/lib/mail/aide-client";
import { acquireMailCodex } from "@/lib/mail/codex-lock";
import {
  LIST_SUMMARY_RETENTION_DAYS,
  createTombstones,
  buildListSummaryPrompt,
  inRetryWait,
  parseListSummaryReply,
  selectMissing,
  type ListSummaryItem,
} from "@/lib/mail/list-summary-core";
import { plainBody } from "@/lib/mail/suggest-core";

/**
 * メール一覧の要約（#851）。**サーバー専用。** 受信トレイのメールだけを本文から要約して `MailListSummary` に持つ。
 *
 * - **#732の例外**: メール由来の文面（要約1〜2文）をDBに残す。件名・差出人・本文は持たない。削除の契機は
 *   ①アーカイブ・ゴミ箱の操作の成功（`/api/mail/actions`） ②一覧でINBOXの無いと分かった行 ③30日経過（`/api/mail/cron` の末尾）
 * - **Codexの排他（`codex-lock.ts`）は空いているときだけ取る。** 取れなければ黙ってスキップして次回へ回し、
 *   利用者操作の分析・指示・学習を優先する
 * - 持ち主の照合は `getMail()` が行う（一致しなければ要約しない）
 */

const TIMEOUT_MS = 120_000;
const lastFailure = new Map<string, number>();
/** 生成中に消された（アーカイブ・ゴミ箱）メール。保存で行を復活させないための印（#860）。 */
const tombstones = createTombstones();

export async function getListSummaries(userId: string, messageIds: string[]): Promise<Map<string, string>> {
  if (messageIds.length === 0) return new Map();
  const rows = await db.mailListSummary.findMany({ where: { userId, messageId: { in: messageIds } }, select: { messageId: true, summary: true } });
  return new Map(rows.map((row) => [row.messageId, row.summary]));
}

export async function deleteListSummaries(userId: string, messageIds: string[]): Promise<void> {
  if (messageIds.length === 0) return;
  // 先に印を付ける（DBの削除より後に付けると、その間の保存が見逃される）
  tombstones.mark(userId, messageIds);
  await db.mailListSummary.deleteMany({ where: { userId, messageId: { in: messageIds } } });
}

/** 期限（30日）を過ぎた行を、全利用者ぶん消す。 */
export async function pruneListSummaries(now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - LIST_SUMMARY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = await db.mailListSummary.deleteMany({ where: { createdAt: { lt: before } } });
  return result.count;
}

/** 失敗は握りつぶしてログだけ（要約できないことで本筋を止めない）。 */
export async function summarizeMissingSafely(user: MailUser, messageIds: string[]): Promise<void> {
  try {
    await summarizeMissing(user, messageIds);
  } catch (error) {
    console.error("[aide-bot] 一覧の要約に失敗した", error instanceof Error ? error.message : error);
  }
}

/** 要約の無い受信トレイのメール（`messageIds` は新しい順）を、上限ぶんだけ要約して保存する。 */
async function summarizeMissing(user: MailUser, messageIds: string[]): Promise<void> {
  if (inRetryWait(lastFailure.get(user.id), Date.now())) return;
  const have = await getListSummaries(user.id, messageIds);
  const targets = selectMissing(messageIds, new Set(have.keys()));
  if (targets.length === 0) return;

  const release = acquireMailCodex(user.id, { kind: "list_summary", key: targets[0]! });
  if (!release) return;
  const startedAt = Date.now();
  try {
    const items: ListSummaryItem[] = [];
    const idByKey = new Map<string, string>();
    for (const id of targets) {
      const mail = await getMail(user, id);
      if (!mail.ok) {
        if (mail.kind === "not_owner") return;
        continue;
      }
      const { message } = mail.value;
      const key = `m${items.length + 1}`;
      idByKey.set(key, id);
      items.push({ key, from: message.from, subject: message.subject, body: plainBody(message.text, message.html) });
    }
    if (items.length === 0) {
      lastFailure.set(user.id, Date.now());
      return;
    }
    const result = await runCodexRecorded({
      userId: user.id,
      feature: "mail_list_summary",
      label: "メール一覧の要約",
      model: await modelFor(user.id, "mail"),
      prompt: buildListSummaryPrompt(items),
      timeoutMs: TIMEOUT_MS,
    });
    const parsed = parseListSummaryReply(result.messages.at(-1) ?? result.text, items.map((item) => item.key));
    if (!parsed || parsed.size === 0) {
      lastFailure.set(user.id, Date.now());
      console.error("[aide-bot] 一覧の要約の返答を読めなかった");
      return;
    }
    lastFailure.delete(user.id);
    const rows = [...parsed]
      .map(([key, summary]) => ({ userId: user.id, messageId: idByKey.get(key)!, summary }))
      .filter((row) => !tombstones.deletedSince(user.id, [row.messageId], startedAt).length);
    if (rows.length === 0) return;
    await db.mailListSummary.createMany({ data: rows, skipDuplicates: true });
    // 保存の確認と書き込みの間に削除が入った回のために、書いた後にも見て、消されたものは消し直す
    const raced = tombstones.deletedSince(user.id, rows.map((row) => row.messageId), startedAt);
    if (raced.length > 0) await db.mailListSummary.deleteMany({ where: { userId: user.id, messageId: { in: raced } } });
  } catch (error) {
    lastFailure.set(user.id, Date.now());
    throw error;
  } finally {
    release();
  }
}
