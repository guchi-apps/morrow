import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  AIDE_LOGIN_FLOW_ID_PATTERN,
  AIDE_SERVER_NAME,
  aideHealthFrom,
  isSafeAuthUrl,
  parseAideCallbackUrl,
  parseAideProbe,
  readAideStatus,
  registeredLoopbackRedirect,
  type AideHealth,
} from "../src/lib/hermes/aide-health.ts";
import type { HermesLink } from "./hermes-link.ts";

/**
 * AIDEの道具の状態の確認・再接続・再ログイン（#1240。設計は `docs/hermes-route.md`「AIDEのOAuthはprofileごと」）。
 *
 * 使うのはHermes本体のRPCだけ（subpcでコマンドを打たずに直すため）。
 * - `mcp.servers.status`: キャッシュ済みの状態（繋がない）
 * - `mcp.servers.test`: 実際に繋いで道具の一覧を取り、切る（`ok` と言えないときだけ）
 * - `reload.mcp`（`confirm: true`）: MCPを畳んで張り直す。**プロンプトキャッシュが捨てられる**ので押したときだけ
 * - `mcp.servers.oauth.start` / `callback` / `poll` / `cancel`: PKCEのログイン。戻り先はHermesがループバックに限るので、
 *   利用者がログイン後に開けなかったページのURLを貼り付け、`callback` でHermesへ渡す（CLIの貼り付けと同じ）
 *
 * **`oauth.start` は始めた時点で既存のトークンを消す**（2026-11-28にsubpcで実測。`tools/connectors/mcp_oauth.py` の
 * `manager.remove()`）。失敗・取り消し・5分の待ちの時間切れでは、Hermesが始める前のトークンへ戻す（`undo()`）。
 * そのため、貼り付けが受け付けられなかった・完了しなかった回はすぐ取り消して戻し、画面は「取り消す」も出す。
 *
 * **認可URL・code・state・エラーの文面はログに出さない。**
 */

/** `mcp.servers.test` の上限（実測0.6秒。AIDEが落ちているときに `/health` を長く待たせない）。 */
const PROBE_TIMEOUT_MS = 15_000;
/** `reload.mcp` の上限（OAuthの待ちを含めて30秒ほどかかりうる）。 */
const RELOAD_TIMEOUT_MS = 60_000;
const START_TIMEOUT_MS = 40_000;
/** 貼り付けを渡してからトークンの保存までを待つ上限と間隔。 */
const POLL_LIMIT_MS = 30_000;
const POLL_INTERVAL_MS = 500;

export class AideActionError extends Error {
  readonly reason: "bad_request" | "login_rejected" | "login_failed";

  constructor(reason: "bad_request" | "login_rejected" | "login_failed", message: string) {
    super(message);
    this.reason = reason;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Hermesの応答がタイムアウトした")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** 状態を読み、`ok` と言えなければ実際に繋いで確かめる。判定できない回は null。 */
export async function probeAideHealth(link: HermesLink): Promise<AideHealth | null> {
  let read;
  try {
    read = readAideStatus(await link.rpc("mcp.servers.status", {}));
  } catch {
    return null; // 古いHermesでメソッドが無いなど
  }
  if (read !== "suspect") return aideHealthFrom(read, null);
  let probe = null;
  try {
    probe = parseAideProbe(await withTimeout(link.rpc("mcp.servers.test", { name: AIDE_SERVER_NAME }), PROBE_TIMEOUT_MS));
  } catch {
    // 確かめられなかった（切れていると断定しない）
  }
  return aideHealthFrom(read, probe);
}

async function reloadMcp(link: HermesLink): Promise<void> {
  await withTimeout(link.rpc("reload.mcp", { confirm: true }), RELOAD_TIMEOUT_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `<profile>/mcp-tokens/aide.client.json` の登録済みの戻り先。無ければ null（Hermesが新しく登録する）。 */
export function readRegisteredRedirect(hermesHome: string): () => Promise<string | null> {
  return async () => {
    try {
      const raw = await readFile(join(hermesHome, "mcp-tokens", `${AIDE_SERVER_NAME}.client.json`), "utf8");
      return registeredLoopbackRedirect(JSON.parse(raw));
    } catch {
      return null;
    }
  };
}

export interface AideControlOptions {
  connect: () => Promise<HermesLink>;
  /** 登録済みの戻り先（DCRのclient_idは戻り先に縛られるので、同じURLで始める）。 */
  registeredRedirect?: () => Promise<string | null>;
  pollLimitMs?: number;
  pollIntervalMs?: number;
}

export function createAideControl(options: AideControlOptions) {
  const pollLimitMs = options.pollLimitMs ?? POLL_LIMIT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  /** 始めたログインの流れ（同時に1つ。新しく始めるときは前のを取り消す）。 */
  let activeFlow: string | null = null;

  async function withLink<T>(run: (link: HermesLink) => Promise<T>): Promise<T> {
    const link = await options.connect();
    try {
      return await run(link);
    } finally {
      link.close();
    }
  }

  /** 流れを取り消す（Hermesが始める前のトークンへ戻す）。失敗しても投げない。 */
  async function cancelFlow(link: HermesLink, flowId: string): Promise<void> {
    if (activeFlow === flowId) activeFlow = null;
    await link.rpc("mcp.servers.oauth.cancel", { name: AIDE_SERVER_NAME, session_id: flowId }).catch(() => undefined);
  }

  return {
    /** MCPを張り直してから状態を返す（「再接続する」）。 */
    reconnect(): Promise<AideHealth | null> {
      return withLink(async (link) => {
        await reloadMcp(link);
        return probeAideHealth(link);
      });
    },

    /** ログインを始め、認可URLを返す（「AIDEに再ログイン」）。 */
    startLogin(): Promise<{ flowId: string; authUrl: string }> {
      return withLink(async (link) => {
        if (activeFlow) await cancelFlow(link, activeFlow);
        const redirect = (await options.registeredRedirect?.()) ?? null;
        let result: Record<string, unknown>;
        try {
          result = await withTimeout(
            link.rpc("mcp.servers.oauth.start", { name: AIDE_SERVER_NAME, ...(redirect ? { client_redirect_uri: redirect } : {}) }),
            START_TIMEOUT_MS,
          );
        } catch {
          throw new AideActionError("login_failed", "ログインを始められなかった");
        }
        const flowId = result.session_id;
        const authUrl = result.auth_url;
        if (typeof flowId !== "string" || !AIDE_LOGIN_FLOW_ID_PATTERN.test(flowId) || !isSafeAuthUrl(authUrl)) {
          throw new AideActionError("login_failed", "ログインの開始の応答が読めない");
        }
        activeFlow = flowId;
        return { flowId, authUrl };
      });
    },

    /** 始めたログインを取り消す（「取り消す」）。Hermesが元のトークンへ戻す。 */
    cancelLogin(flowId: string): Promise<void> {
      if (!AIDE_LOGIN_FLOW_ID_PATTERN.test(flowId)) return Promise.reject(new AideActionError("bad_request", "流れのidの形が正しくない"));
      return withLink((link) => cancelFlow(link, flowId));
    },

    /** 貼り付けたURLをHermesへ渡し、保存を待って張り直す。 */
    completeLogin(flowId: string, callbackUrl: string): Promise<AideHealth | null> {
      if (!AIDE_LOGIN_FLOW_ID_PATTERN.test(flowId)) return Promise.reject(new AideActionError("bad_request", "流れのidの形が正しくない"));
      const callback = parseAideCallbackUrl(callbackUrl);
      if (!callback) return Promise.reject(new AideActionError("bad_request", "貼り付けたURLの形が正しくない"));
      return withLink(async (link) => {
        const delivered = await link
          .rpc("mcp.servers.oauth.callback", {
            name: AIDE_SERVER_NAME,
            session_id: flowId,
            code: callback.code,
            state: callback.state,
            error: callback.error,
            iss: callback.iss,
          })
          .catch(() => null);
        if (delivered?.ok !== true) {
          // 待っている流れを残すと、5分のあいだトークンが消えたままになる
          await cancelFlow(link, flowId);
          throw new AideActionError("login_rejected", "Hermesが貼り付けたURLを受け付けなかった");
        }
        const deadline = Date.now() + pollLimitMs;
        for (;;) {
          const polled = await link.rpc("mcp.servers.oauth.poll", { name: AIDE_SERVER_NAME, session_id: flowId }).catch(() => null);
          if (polled?.status === "approved") break;
          if (polled?.status === "error" || Date.now() >= deadline) {
            await cancelFlow(link, flowId);
            throw new AideActionError("login_failed", "ログインが完了しなかった");
          }
          await sleep(pollIntervalMs);
        }
        if (activeFlow === flowId) activeFlow = null;
        // トークンは保存された。張り直しに失敗しても次の利用でHermesが読み直すので、状態だけ返す
        await reloadMcp(link).catch(() => undefined);
        return probeAideHealth(link);
      });
    },
  };
}

export type AideControl = ReturnType<typeof createAideControl>;
