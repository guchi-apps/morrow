import { createPublicKey, verify, type JsonWebKey } from "node:crypto";

import { MAIN_ACCOUNT_KEY, mailAccountKeyOf } from "@/lib/mail/contract";

/**
 * Gmailのpush通知（`users.watch`＋Cloud Pub/Sub。#769）の受け口のうち、DB・ネットワークに触れない部分。
 * `test/gmail-push.test.ts` が固定する。
 *
 * Pub/Subのpushサブスクリプションは、認証を有効にすると `Authorization: Bearer <OIDCトークン>` を付けて
 * POSTしてくる。トークンはGoogleが署名したJWT（RS256）で、`aud` はサブスクリプションに設定した値、
 * `email` はサブスクリプションに結び付けたサービスアカウント。**依存は足さず `node:crypto` で検証する**（#769で決定）。
 *
 * 誰でもGoogle署名のIDトークンを（任意の `aud` で）作れるので、署名だけでは足りない。`aud` と `email` の
 * 両方を設定値と突き合わせる。
 */

export const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"] as const;
/** 時計のずれの許容（秒）。 */
export const CLOCK_SKEW_SECONDS = 300;

export type GmailPushConfig = {
  /** pushサブスクリプションの「オーディエンス」に設定した値。 */
  audience: string;
  /** pushサブスクリプションに結び付けたサービスアカウントのメール。 */
  serviceAccount: string;
};

/** 本番の受け口のURL。サブスクリプションのオーディエンスの既定値にもする。 */
export const DEFAULT_GMAIL_PUSH_AUDIENCE = "https://aide-bot.gucchii.com/api/mail/push";

/**
 * 設定を読む。**サービスアカウントが未設定なら null（受け口ごと閉じる）**——「未設定なら誰でも叩ける」に
 * しない（`/api/briefing` と同じ考え方）。オーディエンスは公開の値なので本番URLを既定にする。
 */
export function gmailPushConfigFrom(env: Record<string, string | undefined>): GmailPushConfig | null {
  const serviceAccount = (env.GMAIL_PUSH_SERVICE_ACCOUNT ?? "").trim();
  if (serviceAccount === "") return null;
  const audience = (env.GMAIL_PUSH_AUDIENCE ?? "").trim() || DEFAULT_GMAIL_PUSH_AUDIENCE;
  return { audience, serviceAccount };
}

export function bearerToken(header: string | null): string | null {
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token === "" ? null : token;
}

function decodeSegment(segment: string): unknown {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 署名を確かめる前に、鍵を選ぶための `kid` だけを読む。RS256以外は null。 */
export function jwtKeyId(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const header = decodeSegment(parts[0]!);
  if (!isRecord(header) || header.alg !== "RS256" || typeof header.kid !== "string" || header.kid === "") return null;
  return header.kid;
}

export type GoogleJwk = JsonWebKey & { kid: string };

/** GoogleのJWKS（`https://www.googleapis.com/oauth2/v3/certs`）の応答から、RSAの鍵だけを取り出す。 */
export function parseJwks(json: unknown): GoogleJwk[] | null {
  if (!isRecord(json) || !Array.isArray(json.keys)) return null;
  const keys = json.keys.filter(
    (key): key is GoogleJwk =>
      isRecord(key) &&
      key.kty === "RSA" &&
      typeof key.kid === "string" &&
      typeof key.n === "string" &&
      typeof key.e === "string",
  );
  return keys;
}

/** `Cache-Control: public, max-age=20000, …` から秒数を取る。読めなければ null。 */
export function maxAgeSeconds(cacheControl: string | null): number | null {
  const match = /(?:^|,)\s*max-age=(\d+)/i.exec(cacheControl ?? "");
  return match ? Number(match[1]) : null;
}

export type VerifyFailure =
  | "malformed"
  | "unknown_key"
  | "bad_signature"
  | "bad_issuer"
  | "bad_audience"
  | "expired"
  | "not_yet_valid"
  | "bad_email";

export type VerifyResult = { ok: true } | { ok: false; reason: VerifyFailure };

/**
 * Pub/Subが付けたOIDCトークンを検証する。署名（RS256）・`iss`・`aud`・`exp`/`iat`・`email`（確認済み）を見る。
 * 失敗の理由はログ用で、応答には出さない。
 */
export function verifyPushToken(
  token: string,
  keys: GoogleJwk[],
  config: GmailPushConfig,
  nowMs: number,
): VerifyResult {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const kid = jwtKeyId(token);
  if (!kid) return { ok: false, reason: "malformed" };
  const payload = decodeSegment(parts[1]!);
  if (!isRecord(payload)) return { ok: false, reason: "malformed" };

  const jwk = keys.find((key) => key.kid === kid);
  if (!jwk) return { ok: false, reason: "unknown_key" };

  let valid = false;
  try {
    const key = createPublicKey({ key: jwk, format: "jwk" });
    valid = verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2]!, "base64url"));
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: "bad_signature" };

  if (typeof payload.iss !== "string" || !(GOOGLE_ISSUERS as readonly string[]).includes(payload.iss)) {
    return { ok: false, reason: "bad_issuer" };
  }
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(config.audience)) return { ok: false, reason: "bad_audience" };

  const now = nowMs / 1000;
  if (typeof payload.exp !== "number" || payload.exp + CLOCK_SKEW_SECONDS < now) return { ok: false, reason: "expired" };
  if (typeof payload.iat === "number" && payload.iat - CLOCK_SKEW_SECONDS > now) return { ok: false, reason: "not_yet_valid" };

  const verified = payload.email_verified === true || payload.email_verified === "true";
  if (
    typeof payload.email !== "string" ||
    !verified ||
    payload.email.trim().toLowerCase() !== config.serviceAccount.trim().toLowerCase()
  ) {
    return { ok: false, reason: "bad_email" };
  }
  return { ok: true };
}

export type GmailPushNotice = { emailAddress: string; historyId: string };

/**
 * Pub/Subのpushの本文（`{ message: { data: <base64>, messageId }, subscription }`）から、Gmailの通知
 * （`{ emailAddress, historyId }`）を取り出す。形が違えば null。件名・本文は来ない。
 */
export function parsePushBody(body: Record<string, unknown> | null): GmailPushNotice | null {
  if (!body || !isRecord(body.message) || typeof body.message.data !== "string") return null;
  let data: unknown;
  try {
    data = JSON.parse(Buffer.from(body.message.data, "base64").toString("utf8"));
  } catch {
    return null;
  }
  if (!isRecord(data) || typeof data.emailAddress !== "string") return null;
  const emailAddress = data.emailAddress.trim();
  if (!emailAddress.includes("@")) return null;
  const historyId =
    typeof data.historyId === "number" || typeof data.historyId === "string" ? String(data.historyId) : "";
  return { emailAddress, historyId };
}

/** push通知の対象（Gmail APIで読んでいるメインのアカウント）のメールか。単一アカウント構成はIDに接頭辞が無い。 */
export function isMainAccountMessage(id: string): boolean {
  const key = mailAccountKeyOf(id);
  return key === null || key === MAIN_ACCOUNT_KEY;
}
