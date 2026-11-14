import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { readJsonObject } from "@/lib/json-body";
import { applyMailAction } from "@/lib/mail/aide-client";
import { deleteAnalyses } from "@/lib/mail/analysis-store";
import { deleteListSummaries } from "@/lib/mail/list-summary";
import {
  MAIL_ACTION_DONE,
  MAIL_ACTION_MAX_IDS,
  MAIL_FAILURE_MESSAGES,
  isMailAction,
  isMailLabelId,
  isMailMessageId,
} from "@/lib/mail/contract";

/**
 * メールの整理（#683）。`{ "action": "archive", "ids": ["…"], "labelId": "Label_1" }` をAIDEの `/api/mail/actions` へ渡す。
 *
 * **持ち主本人の照合は `applyMailAction()` が送る前と後の両方で行う**（AIDEは変更した後でしか `owner` を返さない）。
 * AIDEに拒否された理由（複数アカウントにまたがる等）は `message` に載せて画面へ返す。
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  }

  const body = await readJsonObject(request);
  const action = body?.action;
  const rawIds = body?.ids;
  if (!isMailAction(action)) {
    return NextResponse.json({ error: "操作の指定が不正です。" }, { status: 400 });
  }
  if (!Array.isArray(rawIds) || rawIds.length === 0 || rawIds.length > MAIL_ACTION_MAX_IDS || !rawIds.every(isMailMessageId)) {
    return NextResponse.json({ error: `メールを1〜${MAIL_ACTION_MAX_IDS}通選んでください。` }, { status: 400 });
  }
  const rawLabel = body?.labelId;
  const labelId = isMailLabelId(rawLabel) ? rawLabel : null;
  if ((action === "label-add" || action === "label-remove") && !labelId) {
    return NextResponse.json({ error: "ラベルを選んでください。" }, { status: 400 });
  }

  const result = await applyMailAction(user, { action, ids: [...new Set(rawIds)], labelId });
  if (!result.ok) {
    const status =
      result.kind === "not_owner" ? 403 : result.kind === "invalid_request" ? 400 : result.kind === "not_found" ? 404 : 502;
    const reason = result.message ? `${MAIL_FAILURE_MESSAGES[result.kind]}（${result.message}）` : MAIL_FAILURE_MESSAGES[result.kind];
    return NextResponse.json({ error: reason, kind: result.kind }, { status });
  }

  // アーカイブ・ゴミ箱に移したメールの要約は消す（#851）。消せなくても操作の成功は返す（残りは一覧・30日掃除が拾う）
  if (action === "archive" || action === "trash") {
    await deleteListSummaries(user.id, [...new Set(rawIds)]).catch((error: unknown) =>
      console.warn("[aide-bot] 一覧の要約の削除に失敗した", error instanceof Error ? error.message : error),
    );
  }

  // 保存した分析（#883）も同じ契機で消す
  if (action === "archive" || action === "trash") {
    await deleteAnalyses(user.id, [...new Set(rawIds)]).catch((error: unknown) =>
      console.warn("[aide-bot] メールの分析の削除に失敗した", error instanceof Error ? error.message : error),
    );
  }

  return NextResponse.json({ done: MAIL_ACTION_DONE[action], count: result.value.count });
}
