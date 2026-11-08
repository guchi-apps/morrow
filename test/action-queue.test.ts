import assert from "node:assert/strict";
import { test } from "node:test";

import { createSerialQueue } from "../src/components/mail/action-queue.ts";

test("操作は同時に走らず、積んだ順に1つずつ流れる", async () => {
  const queue = createSerialQueue();
  const log: string[] = [];
  let running = 0;
  const task = (name: string, fail = false) => async () => {
    running += 1;
    assert.equal(running, 1);
    log.push(`start:${name}`);
    await new Promise((r) => setTimeout(r, 5));
    log.push(`end:${name}`);
    running -= 1;
    if (fail) throw new Error(name);
    return name;
  };
  const results = await Promise.allSettled([queue.enqueue(task("a")), queue.enqueue(task("b", true)), queue.enqueue(task("c"))]);
  assert.deepEqual(log, ["start:a", "end:a", "start:b", "end:b", "start:c", "end:c"]);
  assert.deepEqual(results.map((r) => r.status), ["fulfilled", "rejected", "fulfilled"]);
  assert.equal(queue.pending(), 0);
});

test("待ち件数が通知される", async () => {
  const queue = createSerialQueue();
  const seen: number[] = [];
  queue.subscribe((n) => seen.push(n));
  await Promise.all([queue.enqueue(async () => 1), queue.enqueue(async () => 2)]);
  assert.deepEqual(seen, [1, 2, 1, 0]);
});
