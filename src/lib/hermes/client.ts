import { sharedTokenOrEnv } from "@/lib/shared-token";
import { createHermesClient, HermesError, type HermesClient } from "./client-core.ts";
import type { HealthBody } from "./contract.ts";

/**
 * Hermesブリッジのクライアント（#737）。宛先とトークンを実行時に読んで `client-core.ts` へ渡す。
 *
 * - 宛先 `HERMES_BRIDGE_URL`: シークレットではない設定値（tailnet名を含むのでGitには入れない）。deploy.ymlで渡す
 * - トークン `MORROW_HERMES_BRIDGE_TOKEN`: issue-deckの共有トークン（`sharedTokenOrEnv()`）。値はログに出さない
 *
 * **サーバー専用**。ブラウザへトークンもsubpcの名前も渡さない。
 */

export async function hermesClient(): Promise<HermesClient> {
  const token = await sharedTokenOrEnv("MORROW_HERMES_BRIDGE_TOKEN", process.env.MORROW_HERMES_BRIDGE_TOKEN);
  return createHermesClient({
    baseUrl: process.env.HERMES_BRIDGE_URL || null,
    token: token || null,
  });
}

/** 画面に出す状態（`/health` を30秒キャッシュ。開くたびに叩かない）。 */
export type HermesStatus =
  | { state: "ok" }
  | { state: "hermes_down" }
  | { state: "unreachable" }
  | { state: "misconfigured" };

const HEALTH_CACHE_MS = 30 * 1000;
let cachedStatus: { status: HermesStatus; at: number } | null = null;
let inflight: Promise<HermesStatus> | null = null;

export async function hermesStatus(now: number = Date.now()): Promise<HermesStatus> {
  if (cachedStatus && now - cachedStatus.at < HEALTH_CACHE_MS) return cachedStatus.status;
  // 走っている取得は共有する（画面の部品が同時に聞いても1本）
  inflight ??= (async (): Promise<HermesStatus> => {
    try {
      const health = await (await hermesClient()).health();
      return health.hermes === "ok" ? { state: "ok" } : { state: "hermes_down" };
    } catch (error) {
      if (error instanceof HermesError) {
        if (error.kind === "rejected" || error.kind === "not_configured") {
          // 設定の不一致。利用者には「接続の設定に問題があります」と出し、原因はログに残す
          console.error(`[aide-bot] Hermesブリッジの設定に問題がある（${error.kind}）`);
          return { state: "misconfigured" };
        }
        if (error.kind === "hermes_down") return { state: "hermes_down" };
      }
      return { state: "unreachable" };
    }
  })()
    .then((status) => {
      cachedStatus = { status, at: Date.now() };
      return status;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export type { HealthBody };
