import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { readJsonObject } from "@/lib/json-body";
import { getMail } from "@/lib/mail/aide-client";
import { isMailMessageId } from "@/lib/mail/contract";
import { addMailLink, eventCandidates, linksForMessage, removeMailLink, taskCandidates } from "@/lib/mail/link";
import { linkKey, normalizeLinkTarget } from "@/lib/mail/link-core";

/**
 * メールと予定・タスクの紐づけ（#834）。
 * - `GET ?id=<メールID>&kind=event|task`: 紐づけ候補（予定は前後の1週間、タスクは未完了）。紐づけ済みは `linked: true`
 * - `POST { id, kind, targetId, calendarId?, title, dateText? }`: 紐づける（メールの持ち主を `getMail()` で照合してから保存）
 * - `DELETE { linkId }`: 紐づけを外す（自分の行だけ）
 * 紐づけは操作の控えで、予定・タスクそのものは変えない。
 */

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const kind = url.searchParams.get("kind");
  if (!isMailMessageId(id) || (kind !== "event" && kind !== "task")) {
    return NextResponse.json({ error: "指定が不正です。" }, { status: 400 });
  }

  const [candidates, links] = await Promise.all([kind === "event" ? eventCandidates(user.id) : taskCandidates(user.id), linksForMessage(user.id, id)]);
  if (!candidates.ok) {
    return NextResponse.json({ error: candidates.message, kind: candidates.kind }, { status: candidates.kind === "unconfigured" ? 503 : 502 });
  }
  const linked = new Set(links.map((l) => linkKey(l.kind, l.targetId)));
  return NextResponse.json({
    items: candidates.items.map((item) => ({ ...item, linked: linked.has(linkKey(item.kind, item.targetId)) })),
  });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const body = await readJsonObject(request);
  if (!isMailMessageId(body?.id)) return NextResponse.json({ error: "メールの指定が不正です。" }, { status: 400 });
  const target = normalizeLinkTarget(body);
  if (!target) return NextResponse.json({ error: "紐づけ先の指定が不正です。" }, { status: 400 });

  // 持ち主の照合（本人のメールだけを紐づける）
  const mail = await getMail(user, body.id);
  if (!mail.ok) {
    const status = mail.kind === "not_owner" ? 403 : mail.kind === "not_found" ? 404 : 502;
    return NextResponse.json({ error: mail.message ?? "メールを読めませんでした。" }, { status });
  }

  if (!(await addMailLink(user.id, body.id, target, "manual"))) {
    return NextResponse.json({ error: "紐づけを保存できませんでした。時間をおいて試してください。" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, links: await linksForMessage(user.id, body.id) });
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const body = await readJsonObject(request);
  const linkId = typeof body?.linkId === "string" && body.linkId.length <= 40 ? body.linkId : null;
  if (!linkId) return NextResponse.json({ error: "指定が不正です。" }, { status: 400 });
  if (!(await removeMailLink(user.id, linkId))) return NextResponse.json({ error: "紐づけが見つかりませんでした。" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
