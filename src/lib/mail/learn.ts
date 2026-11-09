import type { Prisma } from "@prisma/client";

import { modelFor } from "@/lib/chat-model-server";
import { runCodexRecorded } from "@/lib/codex-run";
import { db } from "@/lib/db";
import { jstDayKey } from "@/lib/day-key";

import { getMail, type MailUser } from "@/lib/mail/aide-client";
import { acquireMailCodex, currentMailCodex } from "@/lib/mail/codex-lock";
import type { MailFailureKind } from "@/lib/mail/contract";
import {
  buildLearnPrompt,
  mergeLearnResult,
  normalizeLearnedRules,
  parseLearnReply,
  ruleKey,
  type LearnChange,
  type LearnedRule,
} from "@/lib/mail/learn-core";
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
  | { ok: true; rules: LearnedRule[]; change: LearnChange; learned: LearnedRule | null }
  | { ok: false; kind: MailFailureKind | "busy" | "failed" | "conflict"; message: string | null };

/** 保存済みの傾向を読む（壊れた値は落とす）。 */
export async function learnedRulesOf(userId: string): Promise<LearnedRule[]> {
  const row = await db.user.findUnique({ where: { id: userId }, select: { mailLearnedRules: true } });
  return normalizeLearnedRules(row?.mailLearnedRules, jstDayKey(new Date()));
}

const UPDATE_ATTEMPTS = 5;

/**
 * 傾向の一覧を「いまの値から作り直して」保存する（#847）。`change` はいまの一覧を受け取り、新しい一覧
 * （保存しないなら null）を返す。**読んだ後に別の書き込みが入っていたら（`updatedAt` が進んでいたら）読み直して
 * やり直す**——読んだ一覧で丸ごと置き換えると、その間の別タブの削除・取り消し・学習を消すため。
 * 何度やっても通らなければ投げる（呼び出し側は失敗として返す）。
 */
export async function updateLearnedRules<T>(
  userId: string,
  change: (current: LearnedRule[], today: string) => { rules: LearnedRule[] | null; result: T },
): Promise<T> {
  for (let attempt = 0; attempt < UPDATE_ATTEMPTS; attempt++) {
    const row = await db.user.findUnique({ where: { id: userId }, select: { mailLearnedRules: true, updatedAt: true } });
    if (!row) throw new Error("利用者が見つからない");
    const today = jstDayKey(new Date());
    const { rules, result } = change(normalizeLearnedRules(row.mailLearnedRules, today), today);
    if (rules === null) return result;
    const { count } = await db.user.updateMany({
      where: { id: userId, updatedAt: row.updatedAt },
      data: { mailLearnedRules: rules as unknown as Prisma.InputJsonValue },
    });
    if (count === 1) return result;
  }
  throw new Error("傾向の一覧の更新が他の書き込みと重なり続けた");
}

export async function learnFromMail(user: MailUser, messageId: string, notify: boolean): Promise<LearnOutcome> {
  const release = acquireMailCodex(user.id, { kind: "learn", key: messageId });
  if (!release) {
    const busyWith = currentMailCodex(user.id)?.kind;
    // メールを開くとAI分析（#766）が自動で走るので、開いた直後に押すとここへ来る
    const message =
      busyWith === "learn"
        ? "別の印から学習しています。少し待ってから、もう一度押してください。"
        : busyWith === "analyze" || busyWith === "list_summary"
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

  // Codexを待つ間に別のタブで一覧が変わっていたら、学習の差分だけを当てる（#847）
  const merged = await updateLearnedRules(user.id, (current, now) => {
    const merge = mergeLearnResult(current, previous, parsed.rules, now);
    return merge.ok ? { rules: merge.rules, result: merge } : { rules: null, result: null };
  });
  if (!merged) {
    return {
      ok: false,
      kind: "conflict",
      message: "学習している間に別の画面で傾向が変わったため、学習の結果は保存しませんでした。もう一度押してください。",
    };
  }
  await db.mailFeedback.upsert({
    where: { userId_messageId: { userId: user.id, messageId } },
    create: { userId: user.id, messageId, notify },
    update: { notify },
  });
  // 取り消しは学習が当てた差分を逆に当てる（`revertLearnResult()`）ので、差分を返す
  const target = parsed.learned;
  const learned = target && merged.rules.some((rule) => ruleKey(rule) === ruleKey(target)) ? target : null;
  return { ok: true, rules: merged.rules, change: merged.change, learned };
}
