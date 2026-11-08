import type { Prisma } from "@prisma/client";

import { modelFor } from "@/lib/chat-model-server";
import { runCodexRecorded } from "@/lib/codex-run";
import { db } from "@/lib/db";
import { jstDayKey } from "@/lib/day-key";

import { getMail, type MailUser } from "@/lib/mail/aide-client";
import { acquireMailCodex, currentMailCodex } from "@/lib/mail/codex-lock";
import type { MailFailureKind } from "@/lib/mail/contract";
import { buildLearnPrompt, normalizeLearnedRules, parseLearnReply, type LearnedRule } from "@/lib/mail/learn-core";
import { plainBody } from "@/lib/mail/suggest-core";
import { SNIPPET_LIMIT } from "@/lib/mail/triage-core";

/**
 * メール通知の学習（#833）。**サーバー専用。**
 *
 * 1. `getMail()` で持ち主を照合し、差出人・件名・冒頭（snippet。無ければ本文の先頭200字）だけを取る
 * 2. Codex（用途「メールの判定」と同じモデル・機能 `mail_learn`）に、いまの傾向一覧と印からの更新を作らせる
 * 3. 読めたら `User.mailLearnedRules` を置き換え、押した印を `MailFeedback` に残す（メッセージIDと向きだけ）
 *
 * **件名・差出人・本文はDB・ログに残さない。** 残るのはCodexが書いた傾向の文だけ。
 * Codexは分析・指示と同じ排他（`codex-lock.ts`）を通り、重なったら `busy`。
 */

const LEARN_TIMEOUT_MS = 120_000;

export type LearnOutcome =
  | { ok: true; rules: LearnedRule[]; previous: LearnedRule[]; learned: LearnedRule | null }
  | { ok: false; kind: MailFailureKind | "busy" | "failed"; message: string | null };

/** 保存済みの傾向を読む（壊れた値は落とす）。 */
export async function learnedRulesOf(userId: string): Promise<LearnedRule[]> {
  const row = await db.user.findUnique({ where: { id: userId }, select: { mailLearnedRules: true } });
  return normalizeLearnedRules(row?.mailLearnedRules, jstDayKey(new Date()));
}

export async function saveLearnedRules(userId: string, rules: LearnedRule[]): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { mailLearnedRules: rules as unknown as Prisma.InputJsonValue },
  });
}

export async function learnFromMail(user: MailUser, messageId: string, notify: boolean): Promise<LearnOutcome> {
  const release = acquireMailCodex(user.id, { kind: "learn", key: messageId });
  if (!release) {
    const busyWith = currentMailCodex(user.id)?.kind;
    // メールを開くとAI分析（#766）が自動で走るので、開いた直後に押すとここへ来る
    const message =
      busyWith === "learn"
        ? "別の印から学習しています。少し待ってから、もう一度押してください。"
        : busyWith === "analyze"
          ? "AIの分析が終わるまで少し待ってから、もう一度押してください。"
          : "指示への返事を作っています。少し待ってから、もう一度押してください。";
    return { ok: false, kind: "busy", message };
  }
  try {
    return await run(user, messageId, notify);
  } catch (error) {
    console.error("[aide-bot] メール通知の学習に失敗した", error instanceof Error ? error.message : error);
    return { ok: false, kind: "failed", message: "学習できませんでした。もう一度試してください。" };
  } finally {
    release();
  }
}

async function run(user: MailUser, messageId: string, notify: boolean): Promise<LearnOutcome> {
  const mail = await getMail(user, messageId);
  if (!mail.ok) return mail;
  const { message } = mail.value;

  const today = jstDayKey(new Date());
  const [previous, triage] = await Promise.all([
    learnedRulesOf(user.id),
    db.mailTriage.findUnique({
      where: { userId_messageId: { userId: user.id, messageId } },
      select: { needed: true },
    }),
  ]);

  const result = await runCodexRecorded({
    userId: user.id,
    feature: "mail_learn",
    label: "メール通知の学習",
    model: await modelFor(user.id, "mail"),
    prompt: buildLearnPrompt(previous, {
      from: message.from,
      subject: message.subject,
      snippet: message.snippet || plainBody(message.text, message.html).slice(0, SNIPPET_LIMIT),
      notify,
      judged: triage ? (triage.needed ? "notified" : "skipped") : "none",
    }),
    timeoutMs: LEARN_TIMEOUT_MS,
  });
  const parsed = parseLearnReply(result.messages.at(-1) ?? result.text, previous, today);
  if (!parsed) {
    console.error("[aide-bot] メール通知の学習の返答を読めなかった");
    return { ok: false, kind: "failed", message: "学習の返答を読めませんでした。もう一度試してください。" };
  }

  await saveLearnedRules(user.id, parsed.rules);
  await db.mailFeedback.upsert({
    where: { userId_messageId: { userId: user.id, messageId } },
    create: { userId: user.id, messageId, notify },
    update: { notify },
  });
  return { ok: true, rules: parsed.rules, previous, learned: parsed.learned };
}
