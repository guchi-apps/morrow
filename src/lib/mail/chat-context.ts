import { modelFor } from "@/lib/chat-model-server";
import { runCodexRecorded } from "@/lib/codex-run";
import { jstDayKey } from "@/lib/day-key";

import { getMail, listMail, type MailUser } from "@/lib/mail/aide-client";
import {
  CONTEXT_MAIL_MAX,
  buildQueryPrompt,
  formatMailContext,
  formatMailFailure,
  mentionsMail,
  parseQueryReply,
  type ContextMail,
  type MailContext,
} from "@/lib/mail/chat-context-core";
import { acquireMailCodex } from "@/lib/mail/codex-lock";
import { MAIL_FAILURE_MESSAGES } from "@/lib/mail/contract";
import { plainBody } from "@/lib/mail/suggest-core";

/**
 * Hermesのチャットでメールに触れる指示のとき、該当メールを取得して発言の先頭へ添える（#813）。**サーバー専用。**
 *
 * - メールに触れそうな指示（キーワード）だけ、Codex（用途「メールの判定」・機能 `mail_chat_query`）で検索条件を作る。
 *   **渡すのは利用者の指示だけ**で、メール本文は条件の生成に渡さない
 * - 一覧・本文の取得は `aide-client.ts` を通る（**持ち主の照合込み**。#683）。本文はMorrowのDB・ログに残さない
 * - 失敗してもターンは止めない（取得できなかった旨をHermesへ伝え、誤って「接続されていない」と答えさせない）
 * - 戻りが null ＝ メールは関係ない指示（何も添えない）
 */

const QUERY_TIMEOUT_MS = 60_000;

export async function mailContextFor(user: MailUser, text: string): Promise<MailContext | null> {
  if (!mentionsMail(text)) return null;

  // メールのAI（分析・指示）と同じく、Codexは利用者ごとに同時1件（`codex-lock.ts`）。走っていれば検索せず、その旨を伝える
  const release = acquireMailCodex(user.id, { kind: "chat", key: "hermes-chat" });
  if (!release) return formatMailFailure("メールのAIが別の処理を実行中のため検索できなかった。少し待って頼み直してもらう");

  let query: string;
  try {
    const result = await runCodexRecorded({
      userId: user.id,
      feature: "mail_chat_query",
      label: "メールの検索条件づくり",
      model: await modelFor(user.id, "mail"),
      prompt: buildQueryPrompt({ text, today: jstDayKey(new Date()) }),
      timeoutMs: QUERY_TIMEOUT_MS,
    });
    const parsed = parseQueryReply(result.messages.at(-1) ?? result.text);
    if (!parsed) return formatMailFailure("検索条件を作れなかった");
    if (!parsed.need) return null;
    query = parsed.query;
  } catch (error) {
    console.error("[aide-bot] メールの検索条件を作れなかった", error instanceof Error ? error.message : error);
    return formatMailFailure("検索条件を作れなかった");
  } finally {
    release();
  }

  try {
    const list = await listMail(user, { q: query });
    if (!list.ok) return formatMailFailure(MAIL_FAILURE_MESSAGES[list.kind]);

    const picked = list.value.messages.slice(0, CONTEXT_MAIL_MAX);
    const details = await Promise.all(picked.map((summary) => getMail(user, summary.id)));
    const mails: ContextMail[] = [];
    for (const [index, detail] of details.entries()) {
      // 本文だけ取れなかった1通は、一覧の冒頭で代える（全体は止めない）。持ち主が違う場合も本文は捨てる
      const summary = picked[index];
      const receivedAt = summary.receivedAt;
      mails.push({
        from: summary.from,
        subject: summary.subject,
        receivedDate: receivedAt ? jstDayKey(new Date(receivedAt)) : null,
        body: detail.ok ? plainBody(detail.value.message.text, detail.value.message.html) : detail.kind === "not_owner" ? "" : summary.snippet,
      });
      if (!detail.ok && detail.kind === "not_owner") return formatMailFailure(MAIL_FAILURE_MESSAGES.not_owner);
    }
    return formatMailContext(query, mails, list.value.partial);
  } catch (error) {
    console.error("[aide-bot] チャット用のメール取得に失敗した", error instanceof Error ? error.message : error);
    return formatMailFailure(MAIL_FAILURE_MESSAGES.failed);
  }
}
