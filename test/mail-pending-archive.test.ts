import assert from "node:assert/strict";
import { test } from "node:test";

import { PENDING_ARCHIVE_TTL_MS, createPendingStore, prunePending } from "../src/lib/mail/pending-archive.ts";

const entry = (opId: string, ids: string[], at = 0) => ({ opId, ids, markRead: false, at });

test("期限切れと形の違う控えは捨てる", () => {
  const list = [entry("a", ["m1"]), entry("b", ["m2"], 1000), { opId: "c" }, null];
  assert.deepEqual(prunePending(list, PENDING_ARCHIVE_TTL_MS).map((e) => e.opId), ["b"]);
  assert.deepEqual(prunePending("x", 0), []);
});

test("控えは保存され、戻した・ゴミ箱へ移したメールは外れる", () => {
  const data = new Map<string, string>();
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  const store = createPendingStore(() => storage, () => 1);
  store.add(entry("a", ["m1", "m2"], 1));
  store.add(entry("b", ["m3"], 1));
  store.dropIds(["m1", "m3"]);
  // 開き直した画面（別のインスタンス）からも読める
  assert.deepEqual(createPendingStore(() => storage, () => 1).list(), [entry("a", ["m2"], 1)]);
  store.remove("a");
  assert.equal(store.get("a"), null);
});

test("保存先が使えなくてもメモリで動く", () => {
  const store = createPendingStore(() => {
    throw new Error("denied");
  }, () => 1);
  store.add(entry("a", ["m1"], 1));
  assert.equal(store.get("a")?.opId, "a");
});
