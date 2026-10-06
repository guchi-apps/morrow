import { Prisma } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { isUserAllowed } from "@/lib/access/client";
import { db } from "@/lib/db";
import { encryptSession } from "@/lib/native-auth/cipher";
import { issueHandoff } from "@/lib/native-auth/handoff";
import { nativeLoginCodeUrl, nativeLoginErrorUrl } from "@/lib/native-auth/native-app";
import { handoffStore } from "@/lib/native-auth/stores";
import { isValidChallenge } from "@/lib/native-auth/tokens";
import { getRequestOrigin } from "@/lib/request-origin";
import { NATIVE_NEXT_MAX_LENGTH, safeInternalPath } from "@/lib/safe-path";
import { signOutThisApp } from "@/lib/supabase/sign-out";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const origin = getRequestOrigin(request);
  const code = searchParams.get("code");
  const next = safeInternalPath(searchParams.get("next"), "/", NATIVE_NEXT_MAX_LENGTH);

  // iOSアプリの認証シート（#441）。戻り先はアプリのスキームで、アプリへ返すのは一度限りの
  // 引き継ぎコードだけ。シートはエフェメラルでCookieを持たないため、セッションは
  // WKWebViewの /auth/native/consume が受け取る。
  const challenge = searchParams.get("challenge");
  const native = searchParams.get("native") === "1" && isValidChallenge(challenge);
  const failure = (error: "auth_failed" | "not_allowed") =>
    NextResponse.redirect(native ? nativeLoginErrorUrl(error) : `${origin}/login?error=${error}`);

  if (!code) {
    return failure("auth_failed");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    return failure("auth_failed");
  }

  const { user } = data;

  // 初期リリースは許可されたユーザーのみ利用可能。
  // 許可外のアカウントはaide-bot側のユーザーを作らず、Supabaseのセッションも破棄する。
  if (!(await isUserAllowed(user))) {
    await signOutThisApp(supabase);
    return failure("not_allowed");
  }

  const metadata = user.user_metadata as Record<string, unknown>;
  const name = (metadata.full_name as string) ?? (metadata.name as string) ?? null;
  const image = (metadata.avatar_url as string) ?? null;

  const profile = { email: user.email ?? null, name, image };
  const upsertUser = () =>
    db.user.upsert({
      where: { supabaseUserId: user.id },
      create: { supabaseUserId: user.id, ...profile },
      update: profile,
    });
  try {
    await upsertUser();
  } catch (e) {
    // 一意制約違反（#457）。同じメールで別の supabaseUserId の行があると email @unique に当たり、
    // 以後ずっとログインできなくなる。Supabase側でアカウントを作り直した場合などに起きる。
    if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") throw e;
    // メールが確認済みのときだけ、既存の行を新しい supabaseUserId へ付け替えて引き継ぐ
    // （未確認のメールで他人の行を奪えないようにする）。
    if (user.email && user.email_confirmed_at) {
      const relinked = await db.user.updateMany({
        where: { email: user.email },
        data: { supabaseUserId: user.id, name, image },
      });
      if (relinked.count > 0) {
        console.warn("[aide-bot] メールが同じ既存ユーザーを新しい supabaseUserId へ付け替えた");
      } else {
        // 同時ログインで supabaseUserId の側が先に作られた場合。引き直す。
        await upsertUser();
      }
    } else {
      console.error("[aide-bot] メールが重複していて、確認済みでないため付け替えなかった");
      await signOutThisApp(supabase);
      return failure("auth_failed");
    }
  }

  if (native && challenge) {
    const session = data.session;
    if (!session) {
      return failure("auth_failed");
    }

    let handoffCode: string;
    try {
      handoffCode = await issueHandoff({
        store: handoffStore,
        challenge,
        sessionCipher: encryptSession(
          JSON.stringify({ accessToken: session.access_token, refreshToken: session.refresh_token }),
        ),
        next,
        now: new Date(),
      });
    } catch (e) {
      console.error("[aide-bot] iOSアプリへの引き継ぎコードを発行できなかった:", e instanceof Error ? e.message : e);
      return failure("auth_failed");
    }

    const nativeResponse = NextResponse.redirect(nativeLoginCodeUrl(handoffCode));
    // シートのCookieはシートの終了で捨てられるが、念のためここでも消す。サーバー側のセッションは
    // 失効させない（引き継ぎ先のWKWebViewが同じセッションを使うため）。
    for (const { name } of request.cookies.getAll()) {
      if (name.startsWith("sb-")) nativeResponse.cookies.delete(name);
    }
    return nativeResponse;
  }

  return NextResponse.redirect(`${origin}${next}`);
}
