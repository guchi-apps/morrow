import { timingSafeEqual } from "node:crypto";

import { NextResponse, after } from "next/server";

import { runMailChecks } from "@/lib/mail/triage";
import { runScheduledPushes } from "@/lib/scheduled-push";

/**
 * 定時のお知らせと、メールの新着確認（#683）を起動する。**cronから叩かれる、利用者のいない経路。**
 * vpsの `cron/crontab.txt` から15分ごと（毎時0・15・30・45分。`scripts/aide-bot-briefing.sh`）に叩かれる。
 *
 * 以前は朝の見通し（#79）・先回りの提案（#325）もここから起動していたが、#675で廃止した。
 * パスと `BRIEFING_TRIGGER_TOKEN` は、vpsのcrontabを変えずに済むよう名前のまま残している。
 *
 * 新しい常駐プロセスを足さないため、スケジューリングは外（`guchi-apps/vps` の
 * `cron/crontab.txt`）に任せ、ここはワンショットで走るだけにしてある。
 *
 * ```
 * 0,15,30,45 * * * /usr/local/bin/aide-bot-briefing.sh   # 中身は POST http://127.0.0.1:3103/api/briefing
 * ```
 *
 * ## 認証
 *
 * ログイン判定を挟まない。cronにはCookieもSupabaseのセッションも無い。代わりに共有
 * シークレットのBearerで守る（ログイン判定を挟まない前例として `/api/connections/callback`）。
 *
 * **`BRIEFING_TRIGGER_TOKEN` が未設定なら、この経路ごと閉じる。** 「未設定なら誰でも
 * 叩ける」にすると、設定漏れがそのまま公開エンドポイントになる（`ALLOWED_GOOGLE_EMAILS`
 * が未設定時に全員拒否なのと同じ考え方）。
 */

export const dynamic = "force-dynamic";

/**
 * 生成は道具を何度か叩くため、既定のタイムアウトでは足りないことがある。
 * cron側も `curl` が待てる範囲に収める。
 */
export const maxDuration = 300;

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  // timingSafeEqual は長さが違うと例外を投げるため、先に長さを見る。
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function isAuthorized(request: Request): boolean {
  const expected = process.env.BRIEFING_TRIGGER_TOKEN ?? "";
  if (expected === "") return false;

  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;

  return safeEqual(header.slice("Bearer ".length), expected);
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    // 未設定なのか値が違うのかを区別して返さない。外から設定状況を探れないようにする。
    return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });
  }

  // 定時のお知らせ（#344）。モデルを呼ばずDBを引くだけなので、応答の後（`after()`）で走らせる。
  after(async () => {
    try {
      const results = await runScheduledPushes();
      for (const { scheduleId, status, delivered, detail } of results) {
        console.info(`[aide-bot] 定時のお知らせ: ${scheduleId} ${status}（${delivered}台）${detail ? ` ${detail}` : ""}`);
      }
    } catch (error) {
      console.error("[aide-bot] 定時のお知らせに失敗した", error);
    }
  });

  // 必要なメールのお知らせ（#683）。新着があったときだけCodexで判定する。定時のお知らせとは独立に走らせる
  // （片方の失敗・待ちでもう片方を止めない）。
  after(async () => {
    try {
      for (const { userId, result } of await runMailChecks()) {
        if (result.status === "checked" && result.judged === 0 && !result.partial) continue;
        console.info(
          `[aide-bot] メールの確認: ${userId} ${result.status}（判定${result.judged}・必要${result.needed}・${result.delivered}台）` +
            `${result.partial ? " 一部のアカウントを取得できず" : ""}${result.failure ? ` ${result.failure}` : ""}`,
        );
      }
    } catch (error) {
      console.error("[aide-bot] メールの確認に失敗した", error);
    }
  });

  return NextResponse.json({ ran: true });
}
