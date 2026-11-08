import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ChatShell } from "@/components/chat/chat-shell";
import { MenuInfo } from "@/components/chat/menu-info";
import { APP_VERSION } from "@/lib/app-version";
import { getCurrentUser } from "@/lib/auth-user";
import { recentTopicCount } from "@/lib/topics";

export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  // proxy.ts が未ログインを弾くため通常ここには来ないが、Supabaseのセッションはあるのに
  // aide-bot側のユーザーが未作成（DBの入れ替え等）の場合に備えてログインへ戻す。
  if (!user) {
    redirect("/login");
  }

  const now = new Date();

  // 溜まっている話題の件数（#144）。`count` 1本なので待ち時間はほとんど足さない。
  const topicCount = await recentTopicCount(user.id, now);

  return (
    <ChatShell
      topicCount={topicCount}
      userLabel={user.name ?? user.email ?? "ログイン中"}
      userEmail={user.email}
      appVersion={APP_VERSION}
      infoSlot={
        <Suspense fallback={null}>
          <MenuInfo userId={user.id} />
        </Suspense>
      }
    >
      {children}
    </ChatShell>
  );
}
