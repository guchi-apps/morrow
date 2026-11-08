import { NextResponse, after } from "next/server";

import { readJsonObject } from "@/lib/json-body";
import { bearerToken, gmailPushConfigFrom, jwtKeyId, parsePushBody, verifyPushToken } from "@/lib/mail/gmail-push-core";
import { googleJwks } from "@/lib/mail/google-jwks";
import { checkMailFromPush } from "@/lib/mail/triage";

/**
 * メインのGmailのpush通知の受け口（#769）。**Cloud Pub/Subのpushサブスクリプションから叩かれる、利用者のいない経路。**
 *
 * AIDEがGmailの資格情報で `users.watch`（受信トレイ）をかけておき、受信のたびにGmail→Pub/Sub→ここへPOSTが来る。
 * 中身は `emailAddress` と `historyId` だけ（件名・本文は来ない）。ここでは判定（`checkMailFromPush()`）を
 * `after()` で起こすだけで、すぐ204を返す（Pub/Subは既定10秒で待ちを打ち切り、再送する）。
 *
 * ## 認証
 *
 * ログイン判定は挟まない（`/api/*` はmiddlewareが素通しにする）。Pub/Subが付けるOIDCトークン（Google署名のJWT）を
 * 検証する（`verifyPushToken()`。依存なし）。`aud` は `GMAIL_PUSH_AUDIENCE`（既定は本番URL）、`email` は
 * `GMAIL_PUSH_SERVICE_ACCOUNT` と突き合わせる。**`GMAIL_PUSH_SERVICE_ACCOUNT` が未設定なら経路ごと401で閉じる。**
 * 未設定なのか値が違うのかは応答で区別しない（理由はログにだけ出す）。
 *
 * 認証を通った後の読めない本文は、400ではなく204で受け取って捨てる——Pub/Subは2xx以外を再送し続けるため。
 */

export const dynamic = "force-dynamic";

export const maxDuration = 180;

export async function POST(request: Request) {
  const config = gmailPushConfigFrom(process.env);
  if (!config) return unauthorized();

  const token = bearerToken(request.headers.get("authorization"));
  const kid = token ? jwtKeyId(token) : null;
  if (!token || !kid) return unauthorized();

  const verdict = verifyPushToken(token, await googleJwks(kid), config, Date.now());
  if (!verdict.ok) {
    console.warn(`[aide-bot] Gmailのpush通知の認証に失敗した（${verdict.reason}）`);
    return unauthorized();
  }

  const notice = parsePushBody(await readJsonObject(request));
  if (!notice) {
    console.warn("[aide-bot] Gmailのpush通知の本文を読めなかった");
    return new NextResponse(null, { status: 204 });
  }

  after(async () => {
    try {
      for (const { userId, result } of await checkMailFromPush(notice.emailAddress)) {
        if (result.status === "checked" && result.judged === 0 && !result.partial) continue;
        if (result.status === "busy") continue;
        console.info(
          `[aide-bot] メールの確認（push・history ${notice.historyId}）: ${userId} ${result.status}` +
            `（判定${result.judged}・必要${result.needed}・${result.delivered}台）` +
            `${result.partial ? " 一部のアカウントを取得できず" : ""}${result.failure ? ` ${result.failure}` : ""}`,
        );
      }
    } catch (error) {
      console.error("[aide-bot] push通知からのメールの確認に失敗した", error instanceof Error ? error.message : error);
    }
  });

  return new NextResponse(null, { status: 204 });
}

function unauthorized() {
  return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });
}
