import { after } from "next/server";

import type { MailUser } from "@/lib/mail/aide-client";
import type { MailSummary } from "@/lib/mail/contract";
import { prefetchAnalysesSafely } from "@/lib/mail/analyze";
import { flowKindsFor } from "@/lib/mail/flow-record";
import { getListSummaries, summarizeMissingSafely } from "@/lib/mail/list-summary";
import { neededTriages } from "@/lib/mail/triage";

/** 一覧の1行（AIDEの行＋Morrowが持つ印・要約）。画面の1ページ目と、続きを返す口（`/api/mail/list`）で共有する（#887）。 */
export type MailListRow = MailSummary & {
  notified: boolean;
  flowKinds: string[];
  /** 一覧の要約（#851）。無ければnull。 */
  summary: string | null;
};

/**
 * 行へ「お知らせ済み」「登録済みの印」「要約」を付ける。受信トレイ表示のときだけ要約を引き、無い分は裏で作る（#851）。
 * `after()` を使うので、Route Handler・ページの描画の中から呼ぶ。
 */
export async function decorateMailRows(user: MailUser, messages: MailSummary[], inboxView: boolean): Promise<MailListRow[]> {
  const ids = messages.map((m) => m.id);
  const summaries = inboxView ? await getListSummaries(user.id, ids).catch(() => new Map<string, string>()) : new Map<string, string>();
  if (inboxView && ids.some((id) => !summaries.has(id))) after(() => summarizeMissingSafely(user, ids));
  // 開く前に分析を済ませておく（#895）。保存済みは先回り側が飛ばす
  if (inboxView && ids.length > 0) after(() => prefetchAnalysesSafely(user, ids));
  const [notified, flowKinds] = await Promise.all([neededTriages(user.id, ids), flowKindsFor(user.id, ids)]);
  return messages.map((message) => ({
    ...message,
    notified: notified.has(message.id),
    summary: summaries.get(message.id) ?? null,
    flowKinds: flowKinds.get(message.id) ?? [],
  }));
}
