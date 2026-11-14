import { NextResponse, after, type NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { parseAccountFilter } from "@/lib/mail/account-filter";
import { listMailForPage } from "@/lib/mail/aide-client";
import { onlyInbox } from "@/lib/mail/archived-memory";
import { MAIL_FAILURE_MESSAGES, isMailPageToken, isMailViewKey } from "@/lib/mail/contract";
import { deleteAnalyses } from "@/lib/mail/analysis-store";
import { deleteListSummaries } from "@/lib/mail/list-summary";
import { decorateMailRows } from "@/lib/mail/list-rows";

/**
 * メール一覧の続きの1ページ（#887）。画面（`/mail`）が、スクロールに合わせて・裏の先読みに叩く。
 * 条件は画面のURLと同じ（`view`・`acct`・`q`）で、`page`（AIDEの次ページトークン）が必須。
 * 持ち主の照合は `listMailForPage()` → `listMail()` の中で行われる。
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const pageToken = params.get("page");
  if (!isMailPageToken(pageToken)) {
    return NextResponse.json({ error: "page が正しくありません。" }, { status: 400 });
  }
  const viewParam = params.get("view");
  const view = isMailViewKey(viewParam) ? viewParam : "inbox";
  const filter = parseAccountFilter(params.get("acct"));
  const q = (params.get("q") ?? "").trim().slice(0, 200);

  const result = await listMailForPage(user, { view, labelId: null, filter, q, pageToken });
  if (!result.ok) {
    const status = result.kind === "not_owner" ? 403 : 502;
    return NextResponse.json({ error: MAIL_FAILURE_MESSAGES[result.kind] }, { status });
  }

  // INBOXの無いメール（アーカイブ・ゴミ箱）の要約は消す（画面の1ページ目と同じ。#851）
  const outside = result.value.messages.filter((m) => !m.labelIds.includes("INBOX")).map((m) => m.id);
  if (outside.length > 0) {
    after(() => deleteListSummaries(user.id, outside).catch(() => undefined));
    after(() => deleteAnalyses(user.id, outside).catch(() => undefined));
  }
  const inboxView = view === "inbox" && !q;
  const messages = inboxView ? onlyInbox(result.value.messages) : result.value.messages;
  const rows = await decorateMailRows(user, messages, inboxView);
  return NextResponse.json({ rows, nextPageToken: result.value.nextPageToken, partial: result.value.partial });
}
