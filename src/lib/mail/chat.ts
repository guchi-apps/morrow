import { modelFor } from "@/lib/chat-model-server";
import { runCodexRecorded } from "@/lib/codex-run";
import { jstDayKey } from "@/lib/day-key";

import { getMail, type MailUser } from "@/lib/mail/aide-client";
import { buildChatPrompt, parseChatReply, type ChatTurn, type MailChatReply } from "@/lib/mail/chat-core";
import { acquireMailCodex, currentMailCodex } from "@/lib/mail/codex-lock";
import type { MailFailureKind } from "@/lib/mail/contract";
import { plainBody, withReceivedDate } from "@/lib/mail/suggest-core";

/**
 * メール本文への指示（#784）。**サーバー専用。** 利用者が書いた指示と、画面が送り直す直近のやり取りでCodexを1回呼ぶ。
 *
 * - **先に `getMail()` で持ち主を照合する**（#683）
 * - やり取り・返事はDB・ログに残さない（画面のstateだけ）。分析（#766）と違って結果も覚えない（同じ指示でも文脈が違う）
 * - Codexは利用者ごとに同時1件（分析と共有の排他。`codex-lock.ts`）。走っていれば `busy`。結果の共有はしない
 * - モデルは用途「メールの分析」（`mail_suggest`）と同じものを使い、使用量は機能 `mail_chat` で残す
 */

const CHAT_TIMEOUT_MS = 150_000;

export type ChatOutcome =
  | { ok: true; result: MailChatReply }
  | { ok: false; kind: MailFailureKind | "busy" | "failed"; message: string | null };

export async function chatAboutMail(user: MailUser, messageId: string, message: string, history: readonly ChatTurn[]): Promise<ChatOutcome> {
  const release = acquireMailCodex(user.id, { kind: "chat", key: messageId });
  if (!release) {
    const busy = currentMailCodex(user.id);
    return {
      ok: false,
      kind: "busy",
      message:
        busy?.kind === "analyze" || busy?.kind === "list_summary"
          ? "分析が終わってから送れます。少し待ってください。"
          : "前の指示への返事を作っています。少し待ってください。",
    };
  }
  try {
    const mail = await getMail(user, messageId);
    if (!mail.ok) return mail;
    const { message: mailMessage } = mail.value;
    const result = await runCodexRecorded({
      userId: user.id,
      feature: "mail_chat",
      label: "メールへの指示",
      model: await modelFor(user.id, "mail_suggest"),
      prompt: buildChatPrompt({
        from: mailMessage.from,
        subject: mailMessage.subject,
        body: plainBody(mailMessage.text, mailMessage.html),
        receivedDate: mailMessage.receivedAt ? jstDayKey(new Date(mailMessage.receivedAt)) : null,
        today: jstDayKey(new Date()),
        history,
        message,
      }),
      timeoutMs: CHAT_TIMEOUT_MS,
    });
    const parsed = parseChatReply(result.messages.at(-1) ?? result.text);
    if (!parsed) {
      console.error("[aide-bot] メールへの指示の返答を読めなかった");
      return { ok: false, kind: "failed", message: "返事を読めませんでした。もう一度送ってください。" };
    }
    return { ok: true, result: { ...parsed, suggest: withReceivedDate(parsed.suggest, mailMessage.receivedAt) } };
  } catch (error) {
    console.error("[aide-bot] メールへの指示に失敗した", error instanceof Error ? error.message : error);
    return { ok: false, kind: "failed", message: "返事を作れませんでした。もう一度送ってください。" };
  } finally {
    release();
  }
}
