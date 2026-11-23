import { createHash } from "node:crypto";

import { allowedUserIds } from "@/lib/allowed-user-ids";
import { modelFor } from "@/lib/chat-model-server";
import { runCodexRecorded } from "@/lib/codex-run";
import { db } from "@/lib/db";
import { prefetchAnalysesSafely } from "@/lib/mail/analyze";
import { deleteListSummaries, summarizeMissingSafely } from "@/lib/mail/list-summary";
import { isPushKindEnabled } from "@/lib/push/kinds-server";
import { sendPushToUser, usersWithSubscriptions } from "@/lib/push/subscriptions";

import { applyMailAction, listMail } from "@/lib/mail/aide-client";
import { recordArchived } from "@/lib/mail/archive-log";
import { deleteAnalyses } from "@/lib/mail/analysis-store";
import { mailAccountKeyOf, type MailFailureKind } from "@/lib/mail/contract";
import { gmailPushConfigFrom, isMainAccountMessage } from "@/lib/mail/gmail-push-core";
import { normalizeLearnedRules } from "@/lib/mail/learn-core";
import {
  SINCE_OVERLAP_MS,
  TRIAGE_BATCH_LIMIT,
  applyCardRule,
  buildTriagePrompt,
  composeMailPushes,
  nextMailCursor,
  parseTriageReply,
  selectCandidates,
  toTriageItems,
  type NeededMail,
} from "@/lib/mail/triage-core";

/**
 * 必要なメールのお知らせ（#683）。**サーバー専用。**
 *
 * 起点は3つ: 15分ごとのcron（`/api/briefing` の `after()`）と、メール画面の「いま確認」（`POST /api/mail/check`）と、
 * メインのGmailのpush通知（`POST /api/mail/push`。#769）。どれも `checkMailForUser()` の同じ流れを通る。
 * cronはpushの取りこぼしの保険として残す（追加のIMAPアカウントはcronだけ）。
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
  /** 判定したうち、メインのアカウント（push通知の対象）のメールの件数。 */
  judgedMain?: number;
  failure?: MailFailureKind;
  message?: string;
};

type CheckUser = { id: string; email: string | null; mailCriteria: string; mailCheckedAt: Date | null; mailLearnedRules: unknown };

const running = new Set<string>();
/** 判定中にpush通知が重なった利用者。終わったらもう一度確かめる（#769）。 */
const rerunRequested = new Set<string>();
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
    select: USER_SELECT,
  });
  if (!user) return empty("failed", { message: "利用者が見つかりません。" });
  return checkMailForUser(user, now);
}

export async function checkMailForUser(user: CheckUser, now = new Date()): Promise<MailCheckResult> {
  if (running.has(user.id)) return empty("busy");
  running.add(user.id);
  try {
    let result = await checkSafely(user, now);
    // 判定中にpush通知（#769）が届いていたら、終わってからもう一度だけ確かめる（既読位置は進んでいるので読み直す）
    while (rerunRequested.delete(user.id)) {
      const fresh = await db.user.findUnique({ where: { id: user.id }, select: USER_SELECT });
      if (!fresh) break;
      result = await checkSafely(fresh, new Date());
    }
    return result;
  } finally {
    running.delete(user.id);
  }
}

async function checkSafely(user: CheckUser, now: Date): Promise<MailCheckResult> {
  try {
    return await check(user, now);
  } catch (error) {
    console.error(`[aide-bot] メールの確認に失敗した: ${user.id}`, error instanceof Error ? error.message : error);
    return empty("failed", { message: "メールの確認に失敗しました。" });
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

  // 新着の要約（#851）。排他が空いていなければ飛ばす。判定と通知を待たせないよう待たずに走らせる
  void summarizeMissingSafely(user, messages.map((m) => m.id));

  const judgedRows = await db.mailTriage.findMany({
    where: { userId: user.id, messageId: { in: messages.map((m) => m.id) } },
    select: { messageId: true },
  });
  const candidates = selectCandidates(
    messages,
    new Set(judgedRows.map((row) => row.messageId)),
    cursor.getTime() - SINCE_OVERLAP_MS,
  );
  // 新着の分析（要約・提案）を先回りで作っておく（#883）。判定・通知を待たせず裏で走らせる
  void prefetchAnalysesSafely(
    user,
    candidates.filter((m) => m.labelIds.includes("INBOX")).map((m) => m.id),
  );

  if (candidates.length === 0) {
    await advance(user.id, cursor, now, { partial, complete: true });
    return empty("checked", base);
  }

  const batch = candidates.slice(0, TRIAGE_BATCH_LIMIT);
  const overflow = candidates.slice(TRIAGE_BATCH_LIMIT);
  const items = toTriageItems(batch);

  const learnedRules = normalizeLearnedRules(user.mailLearnedRules, "");
  let decisions;
  try {
    const result = await runCodexRecorded({
      userId: user.id,
      feature: "mail",
      label: "メールの判定",
      model: await modelFor(user.id, "mail"),
      // 学んだ傾向（#833）も添える。DBの値も外から来た値と同じく均してから入れる
      prompt: buildTriagePrompt(user.mailCriteria, items, learnedRules),
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
  const toArchive: string[] = [];
  const hasArchiveRule = learnedRules.some((rule) => rule.archive);
  const rows: { userId: string; messageId: string; needed: boolean; reason: string }[] = [];
  for (const { key, message } of items) {
    const raw = decisions.get(key);
    if (!raw) continue;
    const decision = applyCardRule(raw); // 返ってこなかったものは記録せず、次の確認でやり直す
    rows.push({ userId: user.id, messageId: message.id, needed: decision.needed, reason: decision.reason });
    // アーカイブは「アーカイブの傾向があり、知らせない」と判定したものだけ（#942）。受信トレイにあるものに限る
    if (!decision.needed && decision.archive && hasArchiveRule && message.labelIds.includes("INBOX")) toArchive.push(message.id);
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

  if (toArchive.length > 0) await archiveJudged(user, toArchive);

  let delivered = 0;
  if (needed.length > 0) {
    const pushes = composeMailPushes(needed, MAIL_NOTICE_KIND);
    // 1通ずつ送る（#1134）。届いた件数は端末×通知の合算ではなく、1通でも届いたかで見る
    const results = await Promise.all(pushes.map((push) => sendPushToUser(user.id, push)));
    delivered = Math.max(...results);
    // 送信の試行が終わったので確定する。端末が無い・オフで届かなかった回は notifiedAt=null のまま判定済みにする
    await db.mailTriage.createMany({
      data: rows
        .filter((row) => neededIds.has(row.messageId))
        .map((row) => ({ ...row, notifiedAt: delivered > 0 ? now : null })),
      skipDuplicates: true,
    });
    if (delivered > 0) {
      // 別プロセスが先に行を作っていても（skipDuplicates で読み飛ばされても）届けた印は付ける
      await db.mailTriage.updateMany({
        where: { userId: user.id, messageId: { in: needed.map((mail) => mail.id) }, notifiedAt: null },
        data: { notifiedAt: now },
      });
      // 記録には件名・差出人を残さない（メールの中身はAIDEにだけ置く）
      const dedupeKey = createHash("sha256").update(needed.map((mail) => mail.id).join(",")).digest("hex").slice(0, 40);
      await db.notificationLog
        .create({
          data: {
            userId: user.id,
            kind: MAIL_NOTICE_KIND,
            dedupeKey,
            title: pushes.length === 1 ? pushes[0]!.title : `必要なメール（${needed.length}通）`,
            body: `${needed.length}通`,
            deliveredCount: delivered,
          },
        })
        .catch((error: unknown) => console.warn("[aide-bot] メールの通知の記録に失敗した", error instanceof Error ? error.message : error));
    }
  }

  await advance(user.id, cursor, now, { partial, complete: decisions.size === items.length });
  const judgedMain = rows.filter((row) => isMainAccountMessage(row.messageId)).length;
  return { status: "checked", judged: rows.length, judgedMain, needed: needed.length, delivered, ...base };
}

/**
 * 学んだ「アーカイブ」の傾向に合った新着を受信トレイから外す（#942）。AIDEは複数アカウントにまたがる操作を断るので
 * アカウントごとに分ける。失敗しても判定・通知は止めない（メールは受信トレイに残るだけ。判定済みなので再試行はしない）。
 */
async function archiveJudged(user: CheckUser, ids: string[]) {
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const key = mailAccountKeyOf(id) ?? "";
    groups.set(key, [...(groups.get(key) ?? []), id]);
  }
  for (const group of groups.values()) {
    const result = await applyMailAction(user, { action: "archive", ids: group, labelId: null });
    if (!result.ok) {
      console.warn(`[aide-bot] メールの自動アーカイブに失敗した: ${result.kind}`);
      continue;
    }
    // 手動のアーカイブ（`/api/mail/actions`）と同じ後始末
    await deleteListSummaries(user.id, group).catch(() => undefined);
    await deleteAnalyses(user.id, group).catch(() => undefined);
    // 自動で外したメールも「最近のアーカイブ」から見返せるようにする（#1122）
    await recordArchived(user.id, group).catch(() => undefined);
  }
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
  const users = await checkTargets();
  const outcomes: { userId: string; result: MailCheckResult }[] = [];
  for (const user of users) {
    const result = await checkMailForUser(user, now);
    warnIfPushMissed(user.id, result);
    outcomes.push({ userId: user.id, result });
  }
  return outcomes;
}

const USER_SELECT = { id: true, email: true, mailCriteria: true, mailCheckedAt: true, mailLearnedRules: true } as const;

/** 確認の対象: 通知を受け取れる端末があり、許可されている利用者。 */
async function checkTargets(): Promise<CheckUser[]> {
  const userIds = await allowedUserIds(await usersWithSubscriptions());
  if (userIds.length === 0) return [];
  return db.user.findMany({ where: { id: { in: userIds }, email: { not: null } }, select: USER_SELECT });
}

/** push通知を最後に受けた時刻（プロセス内。ログの手掛かりにだけ使う）。 */
const lastPushAt = new Map<string, number>();

/**
 * **cronがメインのアカウントの新着を判定したら、pushで拾えていなかったということ**（#769）。pushが届いていれば
 * その場で判定済みになり、cronの回には残らない。watchの期限切れ（7日）・かけ直しの失敗・Pub/Subの設定の不備で
 * 黙って止まらないよう、push通知を設定している環境ではログに残す。再起動の直後や、判定の途中で止まった回にも出うる。
 */
function warnIfPushMissed(userId: string, result: MailCheckResult) {
  if (!gmailPushConfigFrom(process.env)) return;
  if (result.status !== "checked" || !result.judgedMain) return;
  const last = lastPushAt.get(userId);
  console.warn(
    `[aide-bot] Gmailのpush通知で拾えなかった新着を定期確認で判定した: ${userId}（${result.judgedMain}通。` +
      `最後のpush: ${last ? new Date(last).toISOString() : "このプロセスでは未受信"}）。watchの期限切れ・Pub/Subの設定を確かめる`,
  );
}

/**
 * メインのGmailのpush通知（#769）から。`emailAddress` と一致する利用者の判定を起こす。一致する利用者が
 * いなければ対象の全員を見る（持ち主でない利用者は `listMail()` の照合で `not_owner` になり何も起きない）。
 *
 * 通知は1通の受信で複数届くことがあり、判定（Codex）の最中にも届く。**判定中（cron・「いま確認」の回を含む）に
 * 届いた分は捨てずに、終わってからもう1回確かめる**（`checkMailForUser()` の中）——`busy` で落とすと、一覧を取った
 * 後に届いたメールが次のcronまで待たされる。重なった通知は1回の確認にまとまる。
 */
export async function checkMailFromPush(emailAddress: string, now = new Date()) {
  const targets = await checkTargets();
  const address = emailAddress.trim().toLowerCase();
  const matched = targets.filter((user) => (user.email ?? "").trim().toLowerCase() === address);
  const users = matched.length > 0 ? matched : targets;
  const outcomes: { userId: string; result: MailCheckResult }[] = [];
  for (const user of users) {
    lastPushAt.set(user.id, now.getTime());
    if (running.has(user.id)) {
      rerunRequested.add(user.id);
      outcomes.push({ userId: user.id, result: empty("busy") });
      continue;
    }
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

/** 本文の画面の帯（#833）のための、このメールの判定結果（判定していなければ null）。 */
export async function mailTriageFor(userId: string, messageId: string) {
  return db.mailTriage.findUnique({
    where: { userId_messageId: { userId, messageId } },
    select: { needed: true, reason: true, notifiedAt: true },
  });
}
