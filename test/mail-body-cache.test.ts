import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { applyMailAction, getMail, getMailCached, prefetchMailBodies } from "@/lib/mail/aide-client";
import {
  MAIL_BODY_MAX_ENTRIES,
  MAIL_BODY_TTL_MS,
  readMailBody,
  resetMailBodyCache,
  writeMailBody,
} from "@/lib/mail/body-cache";

/**
 * メール本文の短期キャッシュ（#1185）。画面表示だけがキャッシュを使い、整理操作の事前の持ち主照合は
 * 毎回AIDEから取ること、持ち主違いを通さないこと、整理操作で破棄されることを固定する。
 */

const OWNER = "owner@example.com";
const user = { id: "u1", email: OWNER };

let fetchCalls: string[] = [];
const realFetch = globalThis.fetch;

function messageJson(id: string, owner = OWNER) {
  return {
    ok: true,
    owner,
    message: { id, threadId: "t", from: "a@b.c", subject: "s", snippet: "", receivedAt: 1, labelIds: ["INBOX"], unread: true, starred: false },
  };
}

beforeEach(() => {
  resetMailBodyCache();
  fetchCalls = [];
  process.env.AIDE_MAIL_API_TOKEN = "test-token";
  process.env.AIDE_MAIL_API_URL = "http://stub.invalid";
  let owner = OWNER;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    fetchCalls.push(`${init?.method ?? "GET"} ${url.replace("http://stub.invalid", "")}`);
    if (url.endsWith("/api/mail/actions")) return Response.json({ ok: true, owner, count: 1 });
    const id = decodeURIComponent(url.split("/").pop() ?? "");
    return Response.json(messageJson(id, owner));
  }) as typeof fetch;
  (globalThis as { __setOwner?: (v: string) => void }).__setOwner = (v) => {
    owner = v;
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("本文キャッシュ（純粋部分）", () => {
  it("期限内は返し、期限を過ぎたら捨てる", () => {
    writeMailBody("u1", "m1", { a: 1 }, 1000);
    assert.deepEqual(readMailBody("u1", "m1", 1000 + MAIL_BODY_TTL_MS - 1), { a: 1 });
    assert.equal(readMailBody("u1", "m1", 1000 + MAIL_BODY_TTL_MS), null);
  });
  it("上限を超えたら古いものから捨てる", () => {
    for (let i = 0; i <= MAIL_BODY_MAX_ENTRIES; i++) writeMailBody("u1", `m${i}`, i, 1);
    assert.equal(readMailBody("u1", "m0", 2), null);
    assert.equal(readMailBody("u1", `m${MAIL_BODY_MAX_ENTRIES}`, 2), MAIL_BODY_MAX_ENTRIES);
  });
  it("利用者が違えば別の鍵", () => {
    writeMailBody("u1", "m1", 1, 1);
    assert.equal(readMailBody("u2", "m1", 2), null);
  });
});

describe("getMailCached", () => {
  it("2回目はAIDEを呼ばずに返す", async () => {
    const a = await getMailCached(user, "m1");
    const b = await getMailCached(user, "m1");
    assert.equal(a.ok && b.ok, true);
    assert.equal(fetchCalls.length, 1);
  });

  it("持ち主が違う利用者には保持済みでも返さない", async () => {
    await getMailCached(user, "m1");
    const other = await getMailCached({ id: "u1", email: "other@example.com" }, "m1");
    assert.equal(other.ok, false);
    assert.equal(!other.ok && other.kind, "not_owner");
  });

  it("getMail は保持済みでも毎回AIDEから取る", async () => {
    await getMailCached(user, "m1");
    fetchCalls = [];
    await getMail(user, "m1");
    assert.equal(fetchCalls.length, 1);
  });
});

describe("整理操作", () => {
  it("事前照合はキャッシュ済みでもAIDEから取り直し、成功後に本文を破棄する", async () => {
    await getMailCached(user, "m1");
    fetchCalls = [];
    const result = await applyMailAction(user, { action: "read", ids: ["m1"], labelId: null });
    assert.equal(result.ok, true);
    assert.deepEqual(fetchCalls, ["GET /api/mail/messages/m1", "POST /api/mail/actions"]);
    assert.equal(readMailBody("u1", "m1"), null);
  });

  it("持ち主が変わっていたら、キャッシュ済みでも操作を送らない", async () => {
    await getMailCached(user, "m1");
    fetchCalls = [];
    (globalThis as unknown as { __setOwner: (v: string) => void }).__setOwner("someone@else.com");
    const result = await applyMailAction(user, { action: "read", ids: ["m1"], labelId: null });
    assert.equal(result.ok, false);
    assert.equal(fetchCalls.some((c) => c.startsWith("POST")), false);
  });
});

describe("先読み", () => {
  it("取って持つ。重なって呼ばれた回は何もしない", async () => {
    const first = prefetchMailBodies(user, ["m1", "m2"]);
    const second = prefetchMailBodies(user, ["m3"]);
    await Promise.all([first, second]);
    assert.equal(readMailBody("u1", "m1") !== null, true);
    assert.equal(readMailBody("u1", "m2") !== null, true);
    assert.equal(readMailBody("u1", "m3"), null);
  });
});
