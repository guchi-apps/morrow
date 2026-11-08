import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
  MAIL_LIST_FRESH_MS,
  MAIL_LIST_STALE_MS,
  cachedMailList,
  invalidateMailList,
  mailListKey,
  resetMailListCache,
} from "../src/lib/mail/list-cache.ts";

type Page = { partial: boolean; messages: string[] };
const ok = (messages: string[], partial = false) => ({ ok: true as const, value: { partial, messages } });

beforeEach(() => resetMailListCache());

function counter(results: Array<ReturnType<typeof ok> | { ok: false }>) {
  let calls = 0;
  const fetcher = async () => results[Math.min(calls++, results.length - 1)] as { ok: true; value: Page } | { ok: false };
  return { fetcher, calls: () => calls };
}

test("新鮮な間は取り直さない", async () => {
  const c = counter([ok(["a"])]);
  const key = mailListKey("u", "e", "q");
  const t = Date.now();
  await cachedMailList("u", key, c.fetcher, t);
  await cachedMailList("u", key, c.fetcher, t + MAIL_LIST_FRESH_MS - 1);
  assert.equal(c.calls(), 1);
});

test("古い値は即返しつつ裏で取り直す", async () => {
  const c = counter([ok(["a"]), ok(["b"])]);
  const key = mailListKey("u", "e", "q");
  const t = Date.now();
  await cachedMailList("u", key, c.fetcher, t);
  const stale = await cachedMailList("u", key, c.fetcher, t + MAIL_LIST_FRESH_MS + 1);
  assert.deepEqual(stale.ok && stale.value.messages, ["a"]);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(c.calls(), 2);
});

test("期限切れは待って取り直す", async () => {
  const c = counter([ok(["a"]), ok(["b"])]);
  const key = mailListKey("u", "e", "q");
  const t = Date.now();
  await cachedMailList("u", key, c.fetcher, t);
  const r = await cachedMailList("u", key, c.fetcher, t + MAIL_LIST_STALE_MS + 1);
  assert.deepEqual(r.ok && r.value.messages, ["b"]);
});

test("partial・失敗は保存しない", async () => {
  const p = counter([ok(["a"], true), ok(["b"])]);
  const key = mailListKey("u", "e", "p");
  await cachedMailList("u", key, p.fetcher);
  const r = await cachedMailList("u", key, p.fetcher);
  assert.deepEqual(r.ok && r.value.messages, ["b"]);
  const f = counter([{ ok: false }, ok(["c"])]);
  const key2 = mailListKey("u", "e", "f");
  await cachedMailList("u", key2, f.fetcher);
  const r2 = await cachedMailList("u", key2, f.fetcher);
  assert.equal(r2.ok, true);
  assert.equal(f.calls(), 2);
});

test("破棄すると取り直し、取得中の古い結果は保存されない", async () => {
  const key = mailListKey("u", "e", "q");
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const slow = async () => {
    await gate;
    return ok(["old"]);
  };
  const pending = cachedMailList("u", key, slow);
  invalidateMailList("u");
  release();
  await pending;
  const c = counter([ok(["new"])]);
  const r = await cachedMailList("u", key, c.fetcher);
  assert.deepEqual(r.ok && r.value.messages, ["new"]);
  assert.equal(c.calls(), 1);
});

test("利用者・メールが違えば共有しない／返却値の書き換えは共有値に影響しない", async () => {
  const c = counter([ok(["a"])]);
  await cachedMailList("u1", mailListKey("u1", "e", "q"), c.fetcher);
  await cachedMailList("u2", mailListKey("u2", "e", "q"), c.fetcher);
  assert.equal(c.calls(), 2);
  const key = mailListKey("u1", "e", "q");
  const first = await cachedMailList("u1", key, c.fetcher);
  if (first.ok) first.value.messages = [];
  const again = await cachedMailList("u1", key, c.fetcher);
  assert.deepEqual(again.ok && again.value.messages, ["a"]);
});
