import { forgetSharedToken, sharedTokenOrEnv } from "@/lib/shared-token";

import {
  isMailOwner,
  parseMailActionResponse,
  parseMailFailure,
  parseMailListResponse,
  parseMailMessageResponse,
  type MailAction,
  type MailActionResult,
  type MailFailureKind,
  type MailListPage,
  type MailMessageResult,
  type MailViewKey,
} from "@/lib/mail/contract";

/**
 * AIDEのメールAPI（`/api/mail/*`）を叩く（#683）。**サーバー専用。**
 *
 * - 認証は共有トークン `AIDE_MAIL_API_TOKEN`（issue-deck）。取れなければ同名の環境変数（手元のスタブ用。本番では配らない）
 * - **応答の `owner` とログイン中（cronでは判定する利用者）のメールを必ず照合し、違えば `not_owner` として中身を捨てる**。
 *   トークンは「Morrowのサーバー」を表すだけで、利用者を区別しないため
 * - **整理の操作はAIDEが変更した後で `owner` を返す**ので、送る前に毎回、対象の1通目の本文を引いて `owner` を照合してから送る。
 *   照合の結果をプロセス内に持ち回さない——Next.jsはページとRoute Handlerで別のモジュールを持つことがあり、手元で実際に、
 *   持ち主が変わった後も別の経路に残った古い照合結果で操作が通った。応答の `owner` も事後に照合する
 * - 件名・差出人・本文・IDはログに出さない（失敗の種類とHTTPステータスだけ）
 */

const TOKEN_NAME = "AIDE_MAIL_API_TOKEN";
const DEFAULT_BASE_URL = "https://aide.gucchii.com";
/** Gmail・IMAPの複数アカウントを束ねると遅いことがある。cron（15分ごと）とも重ならない長さに収める。 */
const TIMEOUT_MS = 25_000;

export type MailUser = { id: string; email: string | null };

export type MailOutcome<T> = { ok: true; value: T } | { ok: false; kind: MailFailureKind; message: string | null };

function baseUrl(): string {
  return (process.env.AIDE_MAIL_API_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

async function call(path: string, init: RequestInit = {}): Promise<{ status: number; json: unknown } | MailOutcome<never>> {
  const token = await sharedTokenOrEnv(TOKEN_NAME, process.env.AIDE_MAIL_API_TOKEN || undefined);
  if (!token) {
    console.error("[aide-bot] メールAPI: AIDE_MAIL_API_TOKEN を取れない（issue-deckの共有トークンが未登録か、接続設定が無い）");
    return { ok: false, kind: "unconfigured", message: null };
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${token}`, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    console.error(`[aide-bot] メールAPI: AIDEに届かない（${error instanceof Error ? error.name : "不明"}）`);
    return { ok: false, kind: "unreachable", message: null };
  }

  // 再発行で古い値が失効した回は、次の呼び出しで取り直させる
  if (response.status === 401) forgetSharedToken(TOKEN_NAME);

  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { status: response.status, json };
}

function failureOf(status: number, json: unknown, label: string): MailOutcome<never> {
  const { kind, message } = parseMailFailure(json, status);
  console.warn(`[aide-bot] メールAPI: ${label}に失敗した（HTTP ${status} ${kind}）`);
  return { ok: false, kind, message };
}

function notOwner(user: MailUser, label: string): MailOutcome<never> {
  // 持ち主のアドレスはログに出さない（利用者の識別子だけ）
  console.warn(`[aide-bot] メールAPI: ${label}の持ち主がログイン中の利用者（${user.id}）と一致しない`);
  return { ok: false, kind: "not_owner", message: null };
}

export type MailListQuery = {
  view?: MailViewKey;
  labelId?: string | null;
  q?: string;
  pageToken?: string | null;
  /** UNIX時刻（ミリ秒）。そのページのうち、受信がこれ以降のものだけ。 */
  since?: number | null;
};

export async function listMail(user: MailUser, query: MailListQuery = {}): Promise<MailOutcome<MailListPage>> {
  const params = new URLSearchParams();
  if (query.labelId) params.set("label", query.labelId);
  else if (query.view && query.view !== "inbox") params.set("view", query.view);
  if (query.q) params.set("q", query.q.slice(0, 200));
  if (query.pageToken) params.set("page", query.pageToken);
  if (query.since != null) params.set("since", String(Math.max(0, Math.floor(query.since))));
  const search = params.toString();

  const result = await call(`/api/mail/messages${search ? `?${search}` : ""}`);
  if ("ok" in result) return result;
  if (result.status !== 200) return failureOf(result.status, result.json, "一覧の取得");

  const page = parseMailListResponse(result.json);
  if (!page) return failureOf(result.status, null, "一覧の読み取り");
  if (!isMailOwner(page.owner, user.email)) return notOwner(user, "一覧");

  return { ok: true, value: page };
}

export async function getMail(user: MailUser, id: string): Promise<MailOutcome<MailMessageResult>> {
  const result = await call(`/api/mail/messages/${encodeURIComponent(id)}`);
  if ("ok" in result) return result;
  if (result.status !== 200) return failureOf(result.status, result.json, "本文の取得");

  const message = parseMailMessageResponse(result.json);
  if (!message) return failureOf(result.status, null, "本文の読み取り");
  if (!isMailOwner(message.owner, user.email)) return notOwner(user, "本文");

  return { ok: true, value: message };
}

export async function applyMailAction(
  user: MailUser,
  input: { action: MailAction; ids: string[]; labelId: string | null },
): Promise<MailOutcome<MailActionResult>> {
  // 事前照合: AIDEは変更した後でしか owner を返さないので、送る前に毎回本人であることを確かめる（`getMail()` が照合する）
  const first = input.ids[0];
  if (!first) return { ok: false, kind: "invalid_request", message: null };
  const probe = await getMail(user, first);
  if (!probe.ok) return probe;

  const result = await call("/api/mail/actions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: input.action, ids: input.ids, labelId: input.labelId }),
  });
  if ("ok" in result) return result;
  if (result.status !== 200) return failureOf(result.status, result.json, `操作（${input.action}）`);

  const done = parseMailActionResponse(result.json);
  if (!done) return failureOf(result.status, null, "操作の応答の読み取り");
  // 事後照合: 変更はもう行われているので取り消せないが、黙って成功にはしない（ログに残し、失敗として見せる）
  if (!isMailOwner(done.owner, user.email)) {
    console.error(`[aide-bot] メールAPI: 操作の応答の持ち主が利用者（${user.id}）と一致しない（変更は行われた可能性がある）`);
    return { ok: false, kind: "not_owner", message: "操作の応答の持ち主が一致しませんでした。変更が行われた可能性があります。" };
  }

  return { ok: true, value: done };
}
