import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { describe, it } from "node:test";

import {
  DEFAULT_GMAIL_PUSH_AUDIENCE,
  bearerToken,
  gmailPushConfigFrom,
  isMainAccountMessage,
  jwtKeyId,
  maxAgeSeconds,
  parseJwks,
  parsePushBody,
  verifyPushToken,
  type GoogleJwk,
} from "@/lib/mail/gmail-push-core";

/** Gmailのpush通知の受け口（#769）のうち、DB・ネットワークに触れない部分。 */

const SA = "gmail-push@example-project.iam.gserviceaccount.com";
const config = { audience: "https://aide-bot.gucchii.com/api/mail/push", serviceAccount: SA };
const NOW = Date.UTC(2026, 10, 8, 3, 0, 0);
const nowSec = Math.floor(NOW / 1000);

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk: GoogleJwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" } as GoogleJwk;

function b64(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function token(
  payload: Record<string, unknown> = {},
  options: { header?: Record<string, unknown>; key?: typeof privateKey } = {},
) {
  const header = b64({ alg: "RS256", kid: "k1", typ: "JWT", ...options.header });
  const body = b64({
    iss: "https://accounts.google.com",
    aud: config.audience,
    iat: nowSec - 10,
    exp: nowSec + 3590,
    email: SA,
    email_verified: true,
    sub: "1234",
    ...payload,
  });
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${body}`), options.key ?? privateKey).toString("base64url");
  return `${header}.${body}.${signature}`;
}

describe("verifyPushToken", () => {
  it("正しいトークンを通す", () => {
    assert.deepEqual(verifyPushToken(token(), [jwk], config, NOW), { ok: true });
  });

  it("issは2つの形のどちらも受ける", () => {
    assert.equal(verifyPushToken(token({ iss: "accounts.google.com" }), [jwk], config, NOW).ok, true);
  });

  it("メールの大文字小文字は均す", () => {
    assert.equal(verifyPushToken(token({ email: SA.toUpperCase() }), [jwk], config, NOW).ok, true);
  });

  const failures: [string, string, VerifyArgs][] = [
    ["別の鍵で署名した", "bad_signature", { key: other.privateKey }],
    ["知らない鍵", "unknown_key", { header: { kid: "k2" } }],
    ["RS256以外", "malformed", { header: { alg: "HS256" } }],
    ["発行者が違う", "bad_issuer", { payload: { iss: "https://evil.example.com" } }],
    ["オーディエンスが違う", "bad_audience", { payload: { aud: "https://evil.example.com/" } }],
    ["期限切れ", "expired", { payload: { exp: nowSec - 600 } }],
    ["expが無い", "expired", { payload: { exp: undefined } }],
    ["未来に発行された", "not_yet_valid", { payload: { iat: nowSec + 3600 } }],
    ["サービスアカウントが違う", "bad_email", { payload: { email: "someone@gmail.com" } }],
    ["メールが未確認", "bad_email", { payload: { email_verified: false } }],
  ];
  type VerifyArgs = { key?: typeof privateKey; header?: Record<string, unknown>; payload?: Record<string, unknown> };
  for (const [name, reason, args] of failures) {
    it(`${name}は断る（${reason}）`, () => {
      const result = verifyPushToken(token(args.payload, { key: args.key, header: args.header }), [jwk], config, NOW);
      assert.deepEqual(result, { ok: false, reason });
    });
  }

  it("時計のずれ（5分以内）は許す", () => {
    assert.equal(verifyPushToken(token({ exp: nowSec - 60 }), [jwk], config, NOW).ok, true);
  });

  it("署名を書き換えた・形の違うトークンは断る", () => {
    const parts = token().split(".");
    const tampered = `${parts[0]}.${b64({ iss: "https://accounts.google.com", aud: config.audience, exp: nowSec + 100, email: SA, email_verified: true })}.${parts[2]}`;
    assert.deepEqual(verifyPushToken(tampered, [jwk], config, NOW), { ok: false, reason: "bad_signature" });
    assert.deepEqual(verifyPushToken("a.b", [jwk], config, NOW), { ok: false, reason: "malformed" });
    assert.deepEqual(verifyPushToken("!!.!!.!!", [jwk], config, NOW), { ok: false, reason: "malformed" });
  });

  it("audが配列でも含まれていれば通す", () => {
    assert.equal(verifyPushToken(token({ aud: ["x", config.audience] }), [jwk], config, NOW).ok, true);
  });
});

describe("gmailPushConfigFrom", () => {
  it("サービスアカウントが無ければ閉じる", () => {
    assert.equal(gmailPushConfigFrom({}), null);
    assert.equal(gmailPushConfigFrom({ GMAIL_PUSH_SERVICE_ACCOUNT: "  " }), null);
  });

  it("オーディエンスの既定は本番URL", () => {
    assert.deepEqual(gmailPushConfigFrom({ GMAIL_PUSH_SERVICE_ACCOUNT: SA }), {
      audience: DEFAULT_GMAIL_PUSH_AUDIENCE,
      serviceAccount: SA,
    });
    assert.equal(gmailPushConfigFrom({ GMAIL_PUSH_SERVICE_ACCOUNT: SA, GMAIL_PUSH_AUDIENCE: "x" })?.audience, "x");
  });
});

describe("parsePushBody", () => {
  const data = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64");

  it("Gmailの通知を取り出す", () => {
    const body = {
      message: { data: data({ emailAddress: "me@gmail.com", historyId: 9876543210 }), messageId: "1" },
      subscription: "projects/p/subscriptions/s",
    };
    assert.deepEqual(parsePushBody(body), { emailAddress: "me@gmail.com", historyId: "9876543210" });
  });

  it("形の違う本文は null", () => {
    assert.equal(parsePushBody(null), null);
    assert.equal(parsePushBody({}), null);
    assert.equal(parsePushBody({ message: { data: 1 } }), null);
    assert.equal(parsePushBody({ message: { data: "not-json" } }), null);
    assert.equal(parsePushBody({ message: { data: data({ historyId: 1 }) } }), null);
    assert.equal(parsePushBody({ message: { data: data({ emailAddress: "nobody" }) } }), null);
  });
});

describe("そのほか", () => {
  it("bearerToken", () => {
    assert.equal(bearerToken("Bearer abc"), "abc");
    assert.equal(bearerToken("bearer abc"), null);
    assert.equal(bearerToken("Bearer "), null);
    assert.equal(bearerToken(null), null);
  });

  it("jwtKeyId", () => {
    assert.equal(jwtKeyId(token()), "k1");
    assert.equal(jwtKeyId(token({}, { header: { kid: "" } })), null);
    assert.equal(jwtKeyId("x"), null);
  });

  it("parseJwks はRSAの鍵だけを残す", () => {
    const keys = parseJwks({ keys: [jwk, { kty: "EC", kid: "e" }, { kty: "RSA", kid: "n-less" }] });
    assert.deepEqual(keys?.map((key) => key.kid), ["k1"]);
    assert.equal(parseJwks({}), null);
  });

  it("maxAgeSeconds", () => {
    assert.equal(maxAgeSeconds("public, max-age=20345, must-revalidate, no-transform"), 20345);
    assert.equal(maxAgeSeconds("no-cache"), null);
    assert.equal(maxAgeSeconds(null), null);
  });

  it("isMainAccountMessage", () => {
    assert.equal(isMainAccountMessage("18c0abc"), true);
    assert.equal(isMainAccountMessage("main~18c0abc"), true);
    assert.equal(isMainAccountMessage("sub~18c0abc"), false);
  });
});
