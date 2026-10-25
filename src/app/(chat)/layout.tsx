import { redirect } from "next/navigation";

import { ChatShell } from "@/components/chat/chat-shell";
import { APP_VERSION } from "@/lib/app-version";
import { getCurrentUser } from "@/lib/auth-user";
import { pendingNoticeCount } from "@/lib/notice-list";
import { recentTopicCount } from "@/lib/topics";

export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  // proxy.ts が未ログインを弾くため通常ここには来ないが、Supabaseのセッションはあるのに
  // aide-bot側のユーザーが未作成（DBの入れ替え等）の場合に備えてログインへ戻す。
  if (!user) {
    redirect("/login");
  }

  const now = new Date();

  // まだ秘書が出していないお知らせの件数（#114）。どの画面でも毎回引くことに
  // なるが、`count` 1本なので一覧の取得と一緒に流して待ち時間を足さない。
  const pendingNoticesPromise = pendingNoticeCount(user.id, now);

  // 溜まっている話題の件数（#144）。こちらも `count` 1本なので同じく並行して流す。
  const topicCountPromise = recentTopicCount(user.id, now);

  const [pendingNotices, topicCount] = await Promise.all([
    pendingNoticesPromise,
    topicCountPromise,
  ]);

  return (
    <ChatShell
      pendingNoticeCount={pendingNotices}
      topicCount={topicCount}
      userLabel={user.name ?? user.email ?? "ログイン中"}
      userEmail={user.email}
      appVersion={APP_VERSION}
    >
      {children}
    </ChatShell>
  );
}
