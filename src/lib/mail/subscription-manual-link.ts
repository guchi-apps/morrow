import { db } from "@/lib/db";
import type { LinkableKind, ManualLink } from "@/lib/mail/subscription-match-core";

/**
 * メールの提案と定期払いの手動の紐づけの控え（#1130）。持つのはメッセージID・種類・選んだ登録idだけ。
 * Asset Managerの登録は変えない（Morrow上の表示の控え）。
 */

export async function getSubscriptionLink(userId: string, messageId: string, kind: LinkableKind): Promise<ManualLink | null> {
  const row = await db.mailSubscriptionLink.findUnique({
    where: { userId_messageId_kind: { userId, messageId, kind } },
    select: { subscriptionId: true },
  });
  return row ? { subscriptionId: row.subscriptionId } : null;
}

export async function saveSubscriptionLink(userId: string, messageId: string, kind: LinkableKind, subscriptionId: number | null): Promise<void> {
  await db.mailSubscriptionLink.upsert({
    where: { userId_messageId_kind: { userId, messageId, kind } },
    create: { userId, messageId, kind, subscriptionId },
    update: { subscriptionId },
  });
}

/** 手動の選択を消して、自動の判定へ戻す。 */
export async function clearSubscriptionLink(userId: string, messageId: string, kind: LinkableKind): Promise<void> {
  await db.mailSubscriptionLink.deleteMany({ where: { userId, messageId, kind } });
}
