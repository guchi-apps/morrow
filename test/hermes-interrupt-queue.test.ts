import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addPendingInterrupt,
  flushInterrupts,
  interruptOutcome,
  listPendingInterrupts,
  removePendingInterrupt,
  type InterruptStorage,
} from "@/lib/hermes/interrupt-queue";

function fakeStorage(): InterruptStorage {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

describe("interruptOutcome", () => {
  it("成功と404は止まったとみなし、通信失敗・5xx・401は再送する", () => {
    assert.equal(interruptOutcome(200), "done");
    assert.equal(interruptOutcome(404), "done");
    assert.equal(interruptOutcome(null), "retry");
    assert.equal(interruptOutcome(502), "retry");
    assert.equal(interruptOutcome(401), "retry");
  });
});

describe("pending interrupts", () => {
  it("interruptが失敗したら控えが残り、次の再送で成功すると消える", async () => {
    const storage = fakeStorage();
    addPendingInterrupt(storage, "turn-1");
    assert.equal(await flushInterrupts(storage, async () => null), true);
    assert.deepEqual(listPendingInterrupts(storage), ["turn-1"]);
    assert.equal(await flushInterrupts(storage, async () => 200), false);
    assert.deepEqual(listPendingInterrupts(storage), []);
  });

  it("send が例外を投げても控えは残る", async () => {
    const storage = fakeStorage();
    addPendingInterrupt(storage, "turn-2");
    assert.equal(
      await flushInterrupts(storage, async () => {
        throw new Error("offline");
      }),
      true,
    );
    removePendingInterrupt(storage, "turn-2");
  });

  it("形の違うidは控えない・重複は1件にまとめる", () => {
    const storage = fakeStorage();
    addPendingInterrupt(storage, "../x");
    addPendingInterrupt(storage, "a");
    addPendingInterrupt(storage, "a");
    assert.deepEqual(listPendingInterrupts(storage), ["a"]);
    removePendingInterrupt(storage, "a");
    assert.deepEqual(listPendingInterrupts(storage), []);
  });
});
