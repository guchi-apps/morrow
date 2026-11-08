import { redirect } from "next/navigation";

import { ChatView } from "@/components/hermes/chat-view";
import { getCurrentUser } from "@/lib/auth-user";
import { listProposals } from "@/lib/hermes/proposals";

/**
 * チャット（#794）。Hermes Agentへ指示する窓口。会話の本文は画面のstateにだけあり、ここで渡すのは
 * 前の会話から残っている確認待ち（`HermesProposal`）だけ。接続状態は画面が `/api/hermes/status` で取る。
 */

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const proposals = await listProposals(user.id);
  const pending = proposals.filter((p) => p.status === "pending" || p.status === "executing" || p.status === "unknown");

  return <ChatView initialPending={pending} />;
}
