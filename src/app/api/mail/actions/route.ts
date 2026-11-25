import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { readJsonObject } from "@/lib/json-body";
import { runMailAction, submitMailAction, type MailActionRun } from "@/lib/mail/action-run";
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
 * 実行は利用者ごとの列（`action-run.ts`）で、接続が切れても最後まで走る（#1192）。
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

  const markRead = body?.markRead === true && action === "archive";
  const input = { action, ids: [...new Set(rawIds)], labelId, markRead };

  // `opId` 付き（アーカイブ）は完了を待たずに受け付ける。画面は同じ `opId` で結果を問い合わせる（#1192）
  const opId = body?.opId;
  let run: MailActionRun;
  if (typeof opId === "string" && /^[A-Za-z0-9-]{8,64}$/.test(opId)) {
    const state = submitMailAction(user, input, opId);
    if (state.state === "running") return NextResponse.json({ state: "running" }, { status: 202 });
    run = state.value;
  } else {
    run = await runMailAction(user, input);
  }

  const { result, markedRead } = run;
  if (!result.ok) {
    const status =
      result.kind === "not_owner" ? 403 : result.kind === "invalid_request" ? 400 : result.kind === "not_found" ? 404 : 502;
    const reason = result.message ? `${MAIL_FAILURE_MESSAGES[result.kind]}（${result.message}）` : MAIL_FAILURE_MESSAGES[result.kind];
    return NextResponse.json({ error: reason, kind: result.kind, markedRead }, { status });
  }

  return NextResponse.json({ done: MAIL_ACTION_DONE[action], count: result.value.count });
}
