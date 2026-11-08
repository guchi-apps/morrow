import { createHash } from "node:crypto";

import { allowedUserIds } from "@/lib/allowed-user-ids";
import { modelFor } from "@/lib/chat-model-server";
import { runCodexRecorded } from "@/lib/codex-run";
import { db } from "@/lib/db";
import { isPushKindEnabled } from "@/lib/push/kinds-server";
import { sendPushToUser, usersWithSubscriptions } from "@/lib/push/subscriptions";

import { listMail } from "@/lib/mail/aide-client";
import type { MailFailureKind } from "@/lib/mail/contract";
import {
  SINCE_OVERLAP_MS,
  TRIAGE_BATCH_LIMIT,
  buildTriagePrompt,
  composeMailPush,
  nextMailCursor,
  parseTriageReply,
  selectCandidates,
  toTriageItems,
  type NeededMail,
} from "@/lib/mail/triage-core";

/**
 * 必要なメールのお知らせ（#683）。**サーバー専用。**
 *
 * 起点は2つ: 15分ごとのcron（`/api/briefing` の `after()`）と、メール画面の「いま確認」（`POST /api/mail/check`）。
 * どちらも `checkMailForUser()` の同じ流れを通る。
 *
 * 1. 通知の種類「必要なメール」がオフなら何もしない（Codexを呼ばない。#488「止めるのは生成の手前」）
 * 2. AIDEから受信トレイの1ページ目を、既読位置（`User.mailCheckedAt`）の少し前以降で取る。持ち主の照合は `listMail()`
 * 3. **初回は既読位置を置くだけ**（溜まっている過去分は知らせない）
 * 4. まだ判定していない新着（`MailTriage` に無いもの）が無ければCodexを呼ばない
 * 5. 新着をまとめて1回だけ判定し、判定を `MailTriage` に残す（**同じメールは二度判定・二度通知しない**。ただし必要と判定した行は通知の試行後に残す。#693）
 * 6. 必要なものがあれば1本の通知にまとめて送る
 * 7. 既読位置を進める。**一覧が `partial`・判定しきれなかった回は進めない**（欠けた分を次で拾い直す）
 */

const TRIAGE_TIMEOUT_MS = 120_000;
/** 「いま確認」を続けて押したときの間隔。Codexの利用枠を連打で減らさない。 */
const MANUAL_INTERVAL_MS = 60_000;
export const MAIL_NOTICE_KIND = "mail-notice";

export type MailCheckStatus =
  | "checked"
  | "initialized"
  | "disabled"
  | "busy"
  | "too_soon"
  | "failed"
  | "not_owner";

export type MailCheckResult = {
  status: MailCheckStatus;
  /** 新しく判定した件数。 */
  judged: number;
  /** そのうち必要と判定した件数。 */
  needed: number;
  /** 通知を届けた端末の数。 */
  delivered: number;
  partial: boolean;
  failedAccounts: string[];
  failure?: MailFailureKind;
  message?: string;
};

type CheckUser = { id: string; email: string | null; mailCriteria: string; mailCheckedAt: Date | null };

const running = new Set<string>();
const lastManual = new Map<string, number>();

function empty(status: MailCheckStatus, extra: Partial<MailCheckResult> = {}): MailCheckResult {
  return { status, judged: 0, needed: 0, delivered: 0, partial: false, failedAccounts: [], ...extra };
}

/** 画面の「いま確認」。cronと同じ流れに、連打の間隔だけを足す。 */
export async function checkMailNow(userId: string, now = new Date()): Promise<MailCheckResult> {
  const last = lastManual.get(userId);
  if (last !== undefined && now.getTime() - last < MANUAL_INTERVAL_MS) return empty("too_soon");
  lastManual.set(userId, now.getTime());

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, mailCriteria: true, mailCheckedAt: true },
  });
  if (!user) return empty("failed", { message: "利用者が見つかりません。" });
  return checkMailForUser(user, now);
}

export async function checkMailForUser(user: CheckUser, now = new Date()): Promise<MailCheckResult> {
  if (running.has(user.id)) return empty("busy");
  running.add(user.id);
  try {
    return await check(user, now);
  } catch (error) {
    console.error(`[aide-bot] メールの確認に失敗した: ${user.id}`, error instanceof Error ? error.message : error);
    return empty("failed", { message: "メールの確認に失敗しました。" });
  } finally {
    running.delete(user.id);
  }
}

async function check(user: CheckUser, now: Date): Promise<MailCheckResult> {
  if (!(await isPushKindEnabled(user.id, "mail-notice"))) return empty("disabled");

  const cursor = user.mailCheckedAt;
  const page = await listMail(user, {
    view: "inbox",
    since: cursor ? cursor.getTime() - SINCE_OVERLAP_MS : null,
  });
  if (!page.ok) {
    return empty(page.kind === "not_owner" ? "not_owner" : "failed", {
      failure: page.kind,
      message: page.message ?? undefined,
    });
  }
  const { partial, failedAccounts, messages } = page.value;
  const base = { partial, failedAccounts };

  // 初回は位置を置くだけ。溜まっている受信トレイを一度に知らせない
  if (!cursor) {
    await db.user.update({ where: { id: user.id }, data: { mailCheckedAt: now } });
    return empty("initialized", base);
  }

  const judgedRows = await db.mailTriage.findMany({
    where: { userId: user.id, messageId: { in: messages.map((m) => m.id) } },
    select: { messageId: true },
  });
  const candidates = selectCandidates(
    messages,
    new Set(judgedRows.map((row) => row.messageId)),
    cursor.getTime() - SINCE_OVERLAP_MS,
  );

  if (candidates.length === 0) {
    await advance(user.id, cursor, now, { partial, complete: true });
    return empty("checked", base);
  }

  const batch = candidates.slice(0, TRIAGE_BATCH_LIMIT);
  const overflow = candidates.slice(TRIAGE_BATCH_LIMIT);
  const items = toTriageItems(batch);

  let decisions;
  try {
    const result = await runCodexRecorded({
      userId: user.id,
      feature: "mail",
      label: "メールの判定",
      model: await modelFor(user.id, "mail"),
      prompt: buildTriagePrompt(user.mailCriteria, items),
      timeoutMs: TRIAGE_TIMEOUT_MS,
    });
    decisions = parseTriageReply(result.messages.at(-1) ?? result.text, items.map((item) => item.key));
  } catch (error) {
    console.error("[aide-bot] メールの判定（Codex）に失敗した", error instanceof Error ? error.message : error);
    return empty("failed", { ...base, message: "メールの判定に失敗しました。次の確認でやり直します。" });
  }
  if (!decisions) {
    console.error("[aide-bot] メールの判定の返答を読めなかった");
    return empty("failed", { ...base, message: "メールの判定の返答を読めませんでした。次の確認でやり直します。" });
  }

  const needed: NeededMail[] = [];
  const rows: { userId: string; messageId: string; needed: boolean; reason: string }[] = [];
  for (const { key, message } of items) {
    const decision = decisions.get(key);
    if (!decision) continue; // 返ってこなかったものは記録せず、次の確認でやり直す
    rows.push({ userId: user.id, messageId: message.id, needed: decision.needed, reason: decision.reason });
    if (decision.needed) needed.push({ id: message.id, from: message.from, subject: message.subject, reason: decision.reason });
  }
  // 1回に載せきれなかった分は、判定を省いたものとして記録する（溜まった分で通知が溢れないように）
  for (const message of overflow) rows.push({ userId: user.id, messageId: message.id, needed: false, reason: "" });

  // **必要と判定した行は、通知の試行が終わるまで確定しない**（#693）。先に作ると、作成と送信のあいだで
  // 止まった回のメールが「判定済み」のまま二度と候補に戻らず、通知が永久に失われる。
  // 不要と判定した行・枠あふれの行は通知と無関係なので先に確定してよい。
  // 送信後・確定前に止まった場合は、次の確認で同じメールを再判定・再通知する（取りこぼすより重複を選ぶ）。
  const neededIds = new Set(needed.map((mail) => mail.id));
  await db.mailTriage.createMany({
    data: rows.filter((row) => !neededIds.has(row.messageId)),
    skipDuplicates: true,
  });

  let delivered = 0;
  if (needed.length > 0) {
    const payload = composeMailPush(needed);
    delivered = await sendPushToUser(user.id, { ...payload, tag: MAIL_NOTICE_KIND });
    // 送信の試行が終わったので確定する。端末が無い・オフで届かなかった回は notifiedAt=null のまま判定済みにする
    await db.mailTriage.createMany({
      data: rows
        .filter((row) => neededIds.has(row.messageId))
        .map((row) => ({ ...row, notifiedAt: delivered > 0 ? now : null })),
      skipDuplicates: true,
    });
    if (delivered > 0) {
      // 記録には件名・差出人を残さない（メールの中身はAIDEにだけ置く）
      const dedupeKey = createHash("sha256").update(needed.map((mail) => mail.id).join(",")).digest("hex").slice(0, 40);
      await db.notificationLog
        .create({
          data: {
            userId: user.id,
            kind: MAIL_NOTICE_KIND,
            dedupeKey,
            title: payload.title,
            body: `${needed.length}通`,
            deliveredCount: delivered,
          },
        })
        .catch((error: unknown) => console.warn("[aide-bot] メールの通知の記録に失敗した", error instanceof Error ? error.message : error));
    }
  }

  await advance(user.id, cursor, now, { partial, complete: decisions.size === items.length });
  return { status: "checked", judged: rows.length, needed: needed.length, delivered, ...base };
}

async function advance(userId: string, cursor: Date, now: Date, options: { partial: boolean; complete: boolean }) {
  const next = nextMailCursor(cursor, now, options);
  if (next.getTime() !== cursor.getTime()) {
    await db.user.update({ where: { id: userId }, data: { mailCheckedAt: next } });
  }
}

/**
 * cron（15分ごと）から。通知を受け取れる端末があり、許可されている利用者だけを見る（持ち主でない利用者は
 * `listMail()` の照合で `not_owner` になり、何も起きない）。
 */
export async function runMailChecks(now = new Date()): Promise<{ userId: string; result: MailCheckResult }[]> {
  const userIds = await allowedUserIds(await usersWithSubscriptions());
  if (userIds.length === 0) return [];
  const users = await db.user.findMany({
    where: { id: { in: userIds }, email: { not: null } },
    select: { id: true, email: true, mailCriteria: true, mailCheckedAt: true },
  });
  const outcomes: { userId: string; result: MailCheckResult }[] = [];
  for (const user of users) {
    outcomes.push({ userId: user.id, result: await checkMailForUser(user, now) });
  }
  return outcomes;
}

/** 一覧の行に「お知らせ済み」を付けるための判定結果（必要と判定したものだけ）。 */
export async function neededTriages(userId: string, messageIds: string[]) {
  if (messageIds.length === 0) return new Map<string, { reason: string; notifiedAt: Date | null; judgedAt: Date }>();
  const rows = await db.mailTriage.findMany({
    where: { userId, needed: true, messageId: { in: messageIds } },
    select: { messageId: true, reason: true, notifiedAt: true, createdAt: true },
  });
  return new Map(rows.map((row) => [row.messageId, { reason: row.reason, notifiedAt: row.notifiedAt, judgedAt: row.createdAt }]));
}
