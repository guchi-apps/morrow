import { db } from "@/lib/db";
import { isStoredUserAllowed } from "@/lib/access/client";

/**
 * StatusHubの共通アクセス設定（#513）で許可されている利用者だけに絞る（cronなど、ログインセッションを通らない経路用）。
 */
export async function allowedUserIds(userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];

  const users = await db.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, supabaseUserId: true, email: true },
  });

  const allowed = await Promise.all(users.map((user) => isStoredUserAllowed(user)));
  return users.filter((_, index) => allowed[index]).map((user) => user.id);
}

/** 利用者IDから許可を再確認する。遅延実行される自動処理の入口で使う。 */
export async function isAllowedUserId(userId: string): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { supabaseUserId: true, email: true } });
  return isStoredUserAllowed(user);
}
