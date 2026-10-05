import type { User } from "@supabase/supabase-js";

import { forgetSharedToken, sharedTokenOrEnv } from "@/lib/shared-token";
import {
  createAccessClient,
  parseAccessResponse,
  type AccessDecision,
  type AccessFetcher,
  type AccessSubject,
} from "@/lib/access/decision";

/**
 * StatusHub共通アクセス設定の判定API（guchi-apps/status-hub の docs/access-control.md。#513）のクライアント。
 * 契約（ttl 30秒・直前の判定は最大5分・一度も判定できていなければ拒否）は `decision.ts` に閉じてある。
 * **旧 `ALLOWED_GOOGLE_EMAILS` は判定にもフォールバックにも使わない。**
 */

const TIMEOUT_MS = 5_000;
const TOKEN_NAME = "MORROW_ACCESS_APP_TOKEN";
/** StatusHub の本番オリジン。`ACCESS_API_URL` は開発などで別の宛先へ向けるときだけ使う。 */
const DEFAULT_ACCESS_API_URL = "https://admin.gucchii.com";

async function post(baseUrl: string, token: string, body: Parameters<AccessFetcher>[0]): Promise<Response> {
  return fetch(`${baseUrl.replace(/\/+$/, "")}/api/access/v1/decision`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/**
 * アプリ別トークンは issue-deck の共有トークン（管理画面の「トークン発行」が自動で書き込む）から読む。
 * 無ければ通信せず失敗＝一度も判定できないので全員拒否になる（未設定が「誰でも通す」に化けない）。
 * 再発行で古いトークンは即失効するため、401ならキャッシュを捨てて読み直し、1回だけ再試行する。
 */
const fetcher: AccessFetcher = async (body) => {
  const baseUrl = process.env.ACCESS_API_URL || DEFAULT_ACCESS_API_URL;
  const token = await sharedTokenOrEnv(TOKEN_NAME, process.env.ACCESS_APP_TOKEN);
  if (!token) throw new Error(`${TOKEN_NAME} が未設定`);

  let response = await post(baseUrl, token, body);
  if (response.status === 401) {
    forgetSharedToken(TOKEN_NAME);
    const renewed = await sharedTokenOrEnv(TOKEN_NAME, process.env.ACCESS_APP_TOKEN);
    if (renewed && renewed !== token) response = await post(baseUrl, renewed, body);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseAccessResponse(await response.json(), body.subject !== undefined);
};

// 開発サーバーの再読み込みで状態が消えないよう globalThis に置く（instrumentation と route が同じ状態を見る）。
const globalForAccess = globalThis as unknown as { __morrowAccess?: ReturnType<typeof createAccessClient> };

function client() {
  globalForAccess.__morrowAccess ??= createAccessClient(fetcher, undefined, Date.now, (error) => {
    console.error("[aide-bot] アクセス判定の取得に失敗:", error instanceof Error ? error.message : error);
  });
  return globalForAccess.__morrowAccess;
}

/**
 * Supabase が検証したユーザーから、判定APIへ送る主体を作る。
 * 確認済みかは Supabase の確認時刻・Googleの email_verified から決める
 * （ブラウザの申告ではなく、サーバーが検証したセッションの値だけを使う）。
 */
export function toAccessSubject(user: Pick<User, "id" | "email" | "email_confirmed_at" | "user_metadata">): AccessSubject {
  const verified = user.user_metadata?.email_verified === true || Boolean(user.email_confirmed_at);
  return { sub: user.id, email: user.email ?? "", emailVerified: verified };
}

export async function decideAccess(subject: AccessSubject): Promise<AccessDecision> {
  return client().decide(subject);
}

export async function isUserAllowed(user: Parameters<typeof toAccessSubject>[0] | null | undefined): Promise<boolean> {
  if (!user) return false;
  return (await decideAccess(toAccessSubject(user))).allowed;
}

/**
 * セッションを持たない経路（cron・遅延実行・起きた合図）用。`User` 行は /auth/callback が
 * 判定を通ったセッションからだけ作るので、行の `supabaseUserId`・メールは検証済みの値。
 * 確認済みとして送ると、ログイン時（`toAccessSubject()`）と同じ `sub`＋メールになりキャッシュも共有される。
 */
export async function isStoredUserAllowed(
  user: { supabaseUserId: string; email: string | null } | null | undefined,
): Promise<boolean> {
  if (!user?.email) return false;
  return (await decideAccess({ sub: user.supabaseUserId, email: user.email, emailVerified: true })).allowed;
}

export async function sendAccessHeartbeat(): Promise<boolean> {
  return client().heartbeat();
}
