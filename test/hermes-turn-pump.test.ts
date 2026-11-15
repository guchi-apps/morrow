import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { clearActiveTurn, peekActiveTurn, saveActiveTurn, saveChatSnapshot, loadChatSnapshot } from "@/lib/hermes/session-memory";
import { applyEvent, initialChatState, startTurn } from "@/lib/hermes/stream-view";
import { expireTurnLog, MAX_LOGGED_EVENTS, registerTurnLog, TurnLog, turnLogOf } from "@/lib/hermes/turn-pump";

describe("ターンのイベントの溜め（#1000）", () => {
  it("途中から購読すると、溜めた続きと新しいイベントを順に受ける", () => {
    const log = new TurnLog<number>();
    log.push(1);
    log.push(2);
    const got: number[] = [];
    let done = false;
    log.subscribe(1, (e) => got.push(e), () => (done = true));
    log.push(3);
    assert.deepEqual(got, [2, 3]);
    log.finish();
    assert.equal(done, true);
  });

  it("購読をやめても溜めは続き、再購読で欠落も重複もない", () => {
    const log = new TurnLog<number>();
    const first: number[] = [];
    const stop = log.subscribe(0, (e) => first.push(e), () => {});
    log.push(1);
    stop();
    log.push(2);
    log.push(3);
    const second: number[] = [];
    log.subscribe(first.length, (e) => second.push(e), () => {});
    assert.deepEqual([...first, ...second], [1, 2, 3]);
  });

  it("終わったあとの購読は、溜めを渡してすぐ終わる", () => {
    const log = new TurnLog<number>();
    log.push(1);
    log.finish();
    const got: number[] = [];
    let done = false;
    log.subscribe(0, (e) => got.push(e), () => (done = true));
    assert.deepEqual(got, [1]);
    assert.equal(done, true);
  });

  it("上限を超えたら溜めるのをやめ、truncatedになる（生中継は続く）", () => {
    const log = new TurnLog<number>();
    const live: number[] = [];
    log.subscribe(0, (e) => live.push(e), () => {});
    for (let i = 0; i < MAX_LOGGED_EVENTS + 1; i += 1) log.push(i);
    assert.equal(log.truncated, true);
    assert.equal(log.length, MAX_LOGGED_EVENTS);
    assert.equal(live.length, MAX_LOGGED_EVENTS + 1);
  });

  it("持ち主だけが溜めを引け、期限が来たら引けない", async () => {
    const log = new TurnLog<number>();
    registerTurnLog("t1", "u1", log as TurnLog<unknown>);
    assert.ok(turnLogOf("t1", "u1"));
    assert.equal(turnLogOf("t1", "u2"), null);
    expireTurnLog("t1", 5);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(turnLogOf("t1", "u1"), null);
  });
});

describe("実行中のまま離れた会話の控え（#1000）", () => {
  it("resumable なら実行中のまま持ち、同じターン・同じ利用者だけが受け直せる", () => {
    let state = startTurn({ ...initialChatState, sessionId: "s1" }, "予定は？");
    state = applyEvent(state, { type: "turn", data: { turnId: "t9", sessionId: "s1" } });
    saveChatSnapshot("u1", state, true);
    saveActiveTurn("u1", "t9", 3);
    assert.equal(loadChatSnapshot("u1")?.running, true);
    assert.deepEqual(peekActiveTurn("u1", state), { turnId: "t9", received: 3 });
    assert.equal(peekActiveTurn("u2", state), null);
    clearActiveTurn();
    assert.equal(peekActiveTurn("u1", state), null);
  });
});
