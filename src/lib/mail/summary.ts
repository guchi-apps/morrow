import { modelFor } from "@/lib/chat-model-server";
import { runCodexRecorded } from "@/lib/codex-run";

import { getMail, type MailUser } from "@/lib/mail/aide-client";
import type { MailFailureKind } from "@/lib/mail/contract";
import { plainBody } from "@/lib/mail/suggest-core";
import { buildSummaryPrompt, parseSummaryReply, type MailSummary } from "@/lib/mail/summary-core";

/**
 * メールの要約（#717）。**サーバー専用。** 押したときだけ走り、何も保存しない。
 * **先に `getMail()` で持ち主を照合する**（#683）。件名・本文・要約はログに出さない。
 */

const SUMMARY_TIMEOUT_MS = 90_000;

const running = new Set<string>();

export type SummaryOutcome =
  | { ok: true; result: MailSummary }
  | { ok: false; kind: MailFailureKind | "busy" | "failed"; message: string | null };

export async function summarizeMail(user: MailUser, messageId: string): Promise<SummaryOutcome> {
  if (running.has(user.id)) return { ok: false, kind: "busy", message: "別の要約を作っています。少し待ってください。" };
  running.add(user.id);
  try {
    const mail = await getMail(user, messageId);
    if (!mail.ok) return mail;
    const { message } = mail.value;

    const result = await runCodexRecorded({
      userId: user.id,
      feature: "mail_summary",
      label: "メールの要約",
      model: await modelFor(user.id, "mail_summary"),
      prompt: buildSummaryPrompt({ from: message.from, subject: message.subject, body: plainBody(message.text, message.html) }),
      timeoutMs: SUMMARY_TIMEOUT_MS,
    });
    const parsed = parseSummaryReply(result.messages.at(-1) ?? result.text);
    if (!parsed) {
      console.error("[aide-bot] メールの要約の返答を読めなかった");
      return { ok: false, kind: "failed", message: "要約の返答を読めませんでした。もう一度試してください。" };
    }
    return { ok: true, result: parsed };
  } catch (error) {
    console.error("[aide-bot] メールの要約に失敗した", error instanceof Error ? error.message : error);
    return { ok: false, kind: "failed", message: "要約を作れませんでした。もう一度試してください。" };
  } finally {
    running.delete(user.id);
  }
}
