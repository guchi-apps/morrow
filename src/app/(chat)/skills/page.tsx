import { redirect } from "next/navigation";

import { SkillsView } from "@/components/hermes/skill-card";
import { getCurrentUser } from "@/lib/auth-user";
import { hermesClient } from "@/lib/hermes/client";
import { HermesError } from "@/lib/hermes/client-core";
import { describeHermesError } from "@/lib/hermes/errors";
import type { InstalledSkill, PendingSkill } from "@/lib/hermes/skill-core";

export const metadata = { title: "スキル" };
export const dynamic = "force-dynamic";

/** Hermesが作ったスキルの確認・承認と、登録済みスキルの一覧・削除（#1154）。 */
export default async function SkillsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  let pending: PendingSkill[] = [];
  let installed: InstalledSkill[] = [];
  let error: string | null = null;
  try {
    const client = await hermesClient();
    [pending, installed] = await Promise.all([client.pendingSkills(), client.installedSkills()]);
  } catch (caught) {
    // 取得できなかったことを「スキルが無い」と混ぜない
    const kind = caught instanceof HermesError ? caught.kind : "unreachable";
    console.warn(`[hermes] スキル一覧の取得に失敗（${kind}）`, caught instanceof Error ? caught.message : String(caught));
    error = describeHermesError(kind).message;
  }

  return (
    <div className="mobile-tab-pad min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 md:px-7">
        <SkillsView pending={pending} installed={installed} error={error} />
      </div>
    </div>
  );
}
