import { redirect } from "next/navigation";

import { MemoryView } from "@/components/hermes/memory-card";
import { getCurrentUser } from "@/lib/auth-user";
import { hermesClient } from "@/lib/hermes/client";
import { HermesError } from "@/lib/hermes/client-core";
import { describeHermesError } from "@/lib/hermes/errors";
import type { MemoryEntry, PendingMemory } from "@/lib/hermes/memory-core";

export const metadata = { title: "記憶" };
export const dynamic = "force-dynamic";

/** Hermesの記憶の確認・承認と、保存済みの記憶の一覧・削除（#1155）。 */
export default async function MemoryPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  let pending: PendingMemory[] = [];
  let entries: MemoryEntry[] = [];
  let error: string | null = null;
  try {
    const client = await hermesClient();
    [pending, entries] = await Promise.all([client.pendingMemories(), client.memoryEntries()]);
  } catch (caught) {
    // 取得できなかったことを「記憶が無い」と混ぜない
    const kind = caught instanceof HermesError ? caught.kind : "unreachable";
    console.warn(`[hermes] 記憶一覧の取得に失敗（${kind}）`, caught instanceof Error ? caught.message : String(caught));
    error = describeHermesError(kind).message;
  }

  return (
    <div className="mobile-tab-pad min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 md:px-7">
        <MemoryView pending={pending} entries={entries} error={error} />
      </div>
    </div>
  );
}
