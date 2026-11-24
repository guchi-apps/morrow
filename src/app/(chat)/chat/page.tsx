import { redirect } from "next/navigation";

import { ChatView } from "@/components/hermes/chat-view";
import { getCurrentUser } from "@/lib/auth-user";
import { SESSION_ID_PATTERN } from "@/lib/hermes/contract";
import { isHermesProfileOwner } from "@/lib/hermes/profile-owner";
import { listProposals } from "@/lib/hermes/proposals";
import { ownsHermesSession } from "@/lib/hermes/session-owner";

/**
 * チャット（#794）。Hermes Agentへ指示する窓口。会話の本文は画面のstate（と端末に覚えたセッションidからの履歴の取り直し。#929）にあり、ここで渡すのは
 * 利用者idと前の会話から残っている確認待ち（`HermesProposal`）だけ。接続状態は画面が `/api/hermes/status` で取る。
 */

export const dynamic = "force-dynamic";

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ session?: string | string[] }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // 共有morrow profileは持ち主だけが使える（#1181）
  if (!isHermesProfileOwner(user)) {
    return <p className="p-6 text-sm text-muted">Hermesのチャットは、profileの持ち主だけが使えます。</p>;
  }

  // 通知「Hermesの返答が届きました」から開いた会話（#1150）。自分のセッションだけ渡す（他人のid・形の違う値は無視）
  const requested = (await searchParams).session;
  const sessionParam = typeof requested === "string" && SESSION_ID_PATTERN.test(requested) ? requested : null;
  const openSessionId = sessionParam && (await ownsHermesSession(user.id, sessionParam).catch(() => false)) ? sessionParam : null;

  const proposals = await listProposals(user.id);
  const pending = proposals.filter((p) => p.status === "pending" || p.status === "executing" || p.status === "unknown");

  return <ChatView userId={user.id} initialPending={pending} openSessionId={openSessionId} />;
}
