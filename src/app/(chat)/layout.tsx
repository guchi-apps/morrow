import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ChatShell } from "@/components/chat/chat-shell";
import { AppBadgeSync } from "@/components/app-badge-sync";
import { MailUnreadBadge } from "@/components/chat/mail-unread-badge";
import { MenuInfo } from "@/components/chat/menu-info";
import { PendingArchiveSync } from "@/components/mail/pending-archive-sync";
import { APP_VERSION } from "@/lib/app-version";
import { getCurrentUser } from "@/lib/auth-user";
import { isHermesProfileOwner } from "@/lib/hermes/profile-owner";
import { countPendingProposals } from "@/lib/hermes/proposals";
import { unreadTopicCount } from "@/lib/topics";

export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  // proxy.ts が未ログインを弾くため通常ここには来ないが、Supabaseのセッションはあるのに
  // aide-bot側のユーザーが未作成（DBの入れ替え等）の場合に備えてログインへ戻す。
  if (!user) {
    redirect("/login");
  }

  const now = new Date();
  const hermesOwner = isHermesProfileOwner(user);

  // ニュースの未読件数（#964）。`count` 1本なので待ち時間はほとんど足さない。
  const [topicCount, pendingProposalCount] = await Promise.all([
    unreadTopicCount(user.id, user.topicsSeenAt, now),
    // Hermesの確認待ちの件数（#794）。左メニューのバッジ。`count` 1本
    // profileの持ち主でない利用者は `/chat` でカードを見られないので数えない（#1189。切替前の確認待ちがバッジに残る）
    hermesOwner ? countPendingProposals(user.id, now) : 0,
  ]);

  return (
    <ChatShell
      topicCount={topicCount}
      pendingProposalCount={pendingProposalCount}
      userLabel={user.name ?? user.email ?? "ログイン中"}
      userEmail={user.email}
      showHermesProfile={hermesOwner}
      appVersion={APP_VERSION}
      mailBadgeSlot={
        <Suspense fallback={null}>
          <MailUnreadBadge user={{ id: user.id, email: user.email }} />
        </Suspense>
      }
      infoSlot={
        <Suspense fallback={null}>
          <MenuInfo userId={user.id} />
        </Suspense>
      }
    >
      <AppBadgeSync enabled={user.appBadgeEnabled} />
      <PendingArchiveSync />
      {children}
    </ChatShell>
  );
}
