import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { isProfileOwner } from "./profile-owner-core";

/**
 * 共有morrow profileの持ち主の照合（#1181）。
 *
 * Hermesのmorrow profile（記憶・スキル・保留）は利用者ごとに分かれていない。ログイン許可済みの別の利用者が
 * 他者の記憶を読み・消し、保留を承認できてしまわないよう、**環境変数 `HERMES_PROFILE_OWNER_EMAIL` のメールの利用者だけ**に
 * 記憶・スキルの画面とAPIを開く。未設定なら全員拒否（設定漏れで公開にしない）。判定の本体は純粋な `isProfileOwner()`。
 */

export const PROFILE_OWNER_ONLY_MESSAGE = "この操作はHermesのprofileの持ち主だけができます。";

export function isHermesProfileOwner(user: { email: string | null } | null | undefined): boolean {
  return isProfileOwner(process.env.HERMES_PROFILE_OWNER_EMAIL, user?.email);
}

/** ページ用: ログイン済みかつprofileの持ち主なら利用者、そうでなければnull。 */
export async function profileOwnerUser() {
  const user = await getCurrentUser();
  return user && isHermesProfileOwner(user) ? user : null;
}

/** Route Handler用: 通れば null、通らなければ返すべきレスポンス（401 未ログイン／403 持ち主でない）。 */
export async function denyUnlessProfileOwner(): Promise<NextResponse | null> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  if (!isHermesProfileOwner(user)) return NextResponse.json({ error: PROFILE_OWNER_ONLY_MESSAGE }, { status: 403 });
  return null;
}
