import { modelFor } from "@/lib/chat-model-server";
import { runCodexRecorded } from "@/lib/codex-run";
import { jstDayKey } from "@/lib/day-key";

import { getMail, type MailUser } from "@/lib/mail/aide-client";
import { analysisCacheKey, buildAnalyzePrompt, freshValue, parseAnalyzeReply, putCache, type CacheEntry, type MailAnalysis } from "@/lib/mail/analyze-core";
import type { MailFailureKind } from "@/lib/mail/contract";
import { plainBody } from "@/lib/mail/suggest-core";

/**
 * メールのAI分析（#766）。**サーバー専用。** メールを開いたときに画面が自動で呼び、要約と提案を1回のCodexで作る。
 *
 * - **先に `getMail()` で持ち主を照合する**（#683）。覚えた結果を返すときも毎回照合する（照合の結果は持ち回さない）
 * - 結果は利用者×メールIDで30分だけプロセス内のメモリに持つ（同じメールを開き直すたびにサブスク枠を使わないため）。
 *   DB・ログには残さない。再起動で消える。`refresh` で取り直す
 * - Codexは利用者ごとに同時1件。同じメールの要求が重なったら走っている1回の結果を共有する
 */

const ANALYZE_TIMEOUT_MS = 150_000;

const cache = new Map<string, CacheEntry<MailAnalysis>>();
/** 走っている分析（利用者ごとに1件）。 */
const running = new Map<string, { key: string; promise: Promise<AnalyzeOutcome> }>();

export type AnalyzeOutcome =
  | { ok: true; result: MailAnalysis; cached: boolean }
  | { ok: false; kind: MailFailureKind | "busy" | "failed"; message: string | null };

export async function analyzeMail(user: MailUser, messageId: string, options: { refresh?: boolean } = {}): Promise<AnalyzeOutcome> {
  const key = analysisCacheKey(user.id, messageId);
  const current = running.get(user.id);
  if (current?.key === key) return current.promise;
  if (current) return { ok: false, kind: "busy", message: "別のメールを分析しています。少し待ってください。" };

  const promise = run(user, messageId, key, options.refresh === true);
  running.set(user.id, { key, promise });
  try {
    return await promise;
  } finally {
    if (running.get(user.id)?.promise === promise) running.delete(user.id);
  }
}

async function run(user: MailUser, messageId: string, key: string, refresh: boolean): Promise<AnalyzeOutcome> {
  try {
    const mail = await getMail(user, messageId);
    if (!mail.ok) {
      cache.delete(key);
      return mail;
    }
    if (!refresh) {
      const hit = freshValue(cache.get(key), Date.now());
      if (hit) return { ok: true, result: hit, cached: true };
    }
    const { message } = mail.value;
    const now = new Date();
    const result = await runCodexRecorded({
      userId: user.id,
      feature: "mail_suggest",
      label: "メールの分析",
      model: await modelFor(user.id, "mail_suggest"),
      prompt: buildAnalyzePrompt({
        from: message.from,
        subject: message.subject,
        body: plainBody(message.text, message.html),
        receivedDate: message.receivedAt ? jstDayKey(new Date(message.receivedAt)) : null,
        today: jstDayKey(now),
      }),
      timeoutMs: ANALYZE_TIMEOUT_MS,
    });
    const parsed = parseAnalyzeReply(result.messages.at(-1) ?? result.text);
    if (!parsed) {
      console.error("[aide-bot] メールの分析の返答を読めなかった");
      return { ok: false, kind: "failed", message: "分析の返答を読めませんでした。もう一度試してください。" };
    }
    putCache(cache, key, parsed, Date.now());
    return { ok: true, result: parsed, cached: false };
  } catch (error) {
    console.error("[aide-bot] メールの分析に失敗した", error instanceof Error ? error.message : error);
    return { ok: false, kind: "failed", message: "分析できませんでした。もう一度試してください。" };
  }
}
