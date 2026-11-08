import { maxAgeSeconds, parseJwks, type GoogleJwk } from "@/lib/mail/gmail-push-core";

/**
 * Googleの公開鍵（JWKS）を取ってプロセス内に持つ（#769）。**サーバー専用。**
 *
 * `Cache-Control` の `max-age` の間は持ち回し（読めなければ1時間）、知らない `kid` が来たときだけ
 * 期限前でも取り直す。取り直しは1分に1回まで（でたらめな `kid` の連打で外へ出続けない）。
 * 取れなかった回は、期限切れでも直前の鍵で検証する（Googleの鍵は入れ替え後もしばらく両方載る）。
 */

const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const DEFAULT_TTL_MS = 60 * 60 * 1000;
const REFETCH_INTERVAL_MS = 60 * 1000;
const TIMEOUT_MS = 5_000;

let cache: { keys: GoogleJwk[]; expiresAt: number } | null = null;
let lastFetchAt = 0;
let inflight: Promise<void> | null = null;

async function refresh(now: number): Promise<void> {
  lastFetchAt = now;
  try {
    const response = await fetch(JWKS_URL, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    if (!response.ok) {
      console.warn(`[aide-bot] Googleの公開鍵を取得できなかった（HTTP ${response.status}）`);
      return;
    }
    const keys = parseJwks(await response.json());
    if (!keys || keys.length === 0) {
      console.warn("[aide-bot] Googleの公開鍵の応答を読めなかった");
      return;
    }
    const ttl = maxAgeSeconds(response.headers.get("cache-control"));
    cache = { keys, expiresAt: now + (ttl !== null ? ttl * 1000 : DEFAULT_TTL_MS) };
  } catch (error) {
    console.warn("[aide-bot] Googleの公開鍵を取得できなかった", error instanceof Error ? error.message : error);
  }
}

/** `kid` を検証できる鍵の一覧を返す。手持ちに無ければ（間隔をあけて）取り直す。 */
export async function googleJwks(kid: string, now = Date.now()): Promise<GoogleJwk[]> {
  const fresh = cache !== null && cache.expiresAt > now;
  const known = cache?.keys.some((key) => key.kid === kid) ?? false;
  if (fresh && known) return cache!.keys;
  // 期限切れ・知らない鍵でも、直前に取りに行ったばかりなら手持ちで答える
  if (now - lastFetchAt < REFETCH_INTERVAL_MS && !inflight) return cache?.keys ?? [];
  inflight ??= refresh(now).finally(() => {
    inflight = null;
  });
  await inflight;
  return cache?.keys ?? [];
}
