import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { readJsonObject } from "@/lib/json-body";
import { getMail } from "@/lib/mail/aide-client";
import { isMailMessageId } from "@/lib/mail/contract";
import { clearSubscriptionLink, saveSubscriptionLink } from "@/lib/mail/subscription-manual-link";
import { isLinkableKind, type LinkableKind } from "@/lib/mail/subscription-match-core";
import { loadRegisteredSubscriptions } from "@/lib/mail/subscription-match";

/**
 * 提案と定期払いの手動の紐づけ（#1130）。Morrow上の表示の控えだけで、Asset Managerの登録は変えない。
 * - GET: 選べる登録済みの定期払いの一覧（読み取りのみ）
 * - PUT `{ id, kind, subscriptionId: number | null }`: 別の定期払いを選ぶ／null＝紐づけなし
 * - DELETE `{ id, kind }`: 手動の選択を消して自動の判定へ戻す
 * 書く前に `getMail()` で持ち主を照合する。
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  const subscriptions = await loadRegisteredSubscriptions(user.id);
  if (!subscriptions) return NextResponse.json({ error: "Asset Managerの一覧を取得できませんでした。" }, { status: 502 });
  return NextResponse.json({ subscriptions });
}

async function authorize(request: Request): Promise<{ response: NextResponse } | { userId: string; id: string; kind: LinkableKind; body: Record<string, unknown> }> {
  const user = await getCurrentUser();
  if (!user) return { response: NextResponse.json({ error: "ログインが必要です。" }, { status: 401 }) };
  const body = await readJsonObject(request);
  if (!body || !isMailMessageId(body.id) || !isLinkableKind(body.kind)) return { response: NextResponse.json({ error: "指定が不正です。" }, { status: 400 }) };
  const mail = await getMail(user, body.id);
  if (!mail.ok) return { response: NextResponse.json({ error: "メールを確認できませんでした。", kind: mail.kind }, { status: mail.kind === "not_owner" ? 403 : 502 }) };
  return { userId: user.id, id: body.id, kind: body.kind, body };
}

export async function PUT(request: Request) {
  const auth = await authorize(request);
  if ("response" in auth) return auth.response;
  const { subscriptionId } = auth.body;
  if (subscriptionId !== null && !(typeof subscriptionId === "number" && Number.isInteger(subscriptionId))) {
    return NextResponse.json({ error: "定期払いの指定が不正です。" }, { status: 400 });
  }
  if (subscriptionId !== null) {
    // 一覧に無いid（解約済み・書き換えられた値）は受け付けない
    const registered = await loadRegisteredSubscriptions(auth.userId);
    if (!registered) return NextResponse.json({ error: "Asset Managerの一覧を取得できませんでした。" }, { status: 502 });
    if (!registered.some((r) => r.id === subscriptionId)) return NextResponse.json({ error: "その定期払いは見つかりません。" }, { status: 404 });
  }
  await saveSubscriptionLink(auth.userId, auth.id, auth.kind, subscriptionId);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const auth = await authorize(request);
  if ("response" in auth) return auth.response;
  await clearSubscriptionLink(auth.userId, auth.id, auth.kind);
  return NextResponse.json({ ok: true });
}
