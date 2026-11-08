import { createHash, timingSafeEqual } from "node:crypto";

/**
 * ブリッジの認証（#737。`docs/hermes-route.md`「認証」）。
 *
 * - Bearerは定数時間で照合する。**トークンが未設定なら全部401**（設定漏れが公開口にならないように）
 * - 送信元は `X-Forwarded-For`（tailscale serveが付けるtailnet IP）が許可リストにあるときだけ通す。
 *   **許可リストが空なら全部403**（同じ理由）
 */

export type AuthResult = "ok" | "unauthorized" | "forbidden";

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function bearerMatches(header: string | undefined, expected: string | undefined): boolean {
  if (!expected) return false;
  const prefix = "Bearer ";
  if (!header || !header.startsWith(prefix)) return false;
  const provided = header.slice(prefix.length);
  if (provided === "") return false;
  // ダイジェスト同士で比べるので、長さの違いで早く抜けない
  return timingSafeEqual(digest(provided), digest(expected));
}

/** `X-Forwarded-For` の先頭（tailscale serveが付けた送信元）。複数あれば最初の1つ。 */
export function forwardedClient(header: string | string[] | undefined): string | null {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return null;
  const first = raw.split(",")[0]?.trim();
  return first ? first : null;
}

export function parseAllowedIps(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function authorize(input: {
  authorization: string | undefined;
  forwardedFor: string | string[] | undefined;
  token: string | undefined;
  allowedIps: string[];
}): AuthResult {
  // トークンの検査を先にする。IPの許可リストの有無を、認証前の相手に漏らさない
  if (!bearerMatches(input.authorization, input.token)) return "unauthorized";
  const client = forwardedClient(input.forwardedFor);
  if (!client || !input.allowedIps.includes(client)) return "forbidden";
  return "ok";
}
