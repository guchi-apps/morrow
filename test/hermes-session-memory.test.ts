import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  clearChatSnapshot,
  clearSessionId,
  loadChatSnapshot,
  loadSessionId,
  saveChatSnapshot,
  saveSessionId,
  type StorageLike,
} from "@/lib/hermes/session-memory";
import { buildPrompt, stripAttachments } from "@/lib/hermes/prompt-attachment";
import { addNotice, applyEvent, initialChatState, restoreFromHistory, startTurn } from "@/lib/hermes/stream-view";

function fakeStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe("チャットの前回の会話の記憶（#929）", () => {
  it("保存したidを同じ利用者だけが読める", () => {
    const s = fakeStorage();
    saveSessionId(s, "u1", "sess-1");
    assert.equal(loadSessionId(s, "u1"), "sess-1");
    assert.equal(loadSessionId(s, "u2"), null);
  });

  it("消すと読めない・壊れた値や不正なidは無視する", () => {
    const s = fakeStorage();
    saveSessionId(s, "u1", "sess-1");
    clearSessionId(s);
    assert.equal(loadSessionId(s, "u1"), null);
    s.setItem("morrow-chat-session", "{oops");
    assert.equal(loadSessionId(s, "u1"), null);
    saveSessionId(s, "u1", "..");
    assert.equal(loadSessionId(s, "u1"), null);
    assert.equal(loadSessionId(null, "u1"), null);
  });

  it("履歴を発言の並びへ戻す（空の発言は捨て、0件ならidだけ持つ）", () => {
    const restored = restoreFromHistory(initialChatState, "sess-1", [
      { role: "user", text: "予定は？" },
      { role: "assistant", text: "  " },
      { role: "assistant", text: "10時です" },
    ]);
    assert.equal(restored.sessionId, "sess-1");
    assert.deepEqual(
      restored.items.map((i) => i.kind),
      ["user", "assistant"],
    );
    const empty = restoreFromHistory(initialChatState, "sess-2", []);
    assert.equal(empty.items.length, 0);
    assert.equal(empty.sessionId, "sess-2");
  });

  it("Morrowが足した注記・メール本文は復元で落とし、入力部分だけ出す", () => {
    const sent = buildPrompt(["確認待ちの伝達", "メール本文"], "返信どうする？");
    assert.equal(stripAttachments(sent), "返信どうする？");
    assert.equal(buildPrompt([null, ""], "そのまま"), "そのまま");
    assert.equal(stripAttachments("区切りなし"), "区切りなし");
    assert.equal(stripAttachments("前<!--morrow-context-->閉じていない"), "前");
    const restored = restoreFromHistory(initialChatState, "s", [{ role: "user", text: sent }]);
    assert.deepEqual(restored.items.map((i) => (i.kind === "user" ? i.text : null)), ["返信どうする？"]);
  });

  it("画面遷移の控えは同じ利用者だけが読め、実行中の印と答えを待つ承認は落とす（#976）", () => {
    clearChatSnapshot();
    let state = restoreFromHistory(initialChatState, "sess-1", [{ role: "user", text: "予定は？" }]);
    state = startTurn(state, "続き");
    state = applyEvent(state, { type: "approval", data: { requestId: "r1", command: "x", description: null } } as never);
    state = addNotice(state, "info", "メモ");
    saveChatSnapshot("u1", state);
    const loaded = loadChatSnapshot("u1");
    assert.ok(loaded);
    assert.equal(loaded.running, false);
    assert.equal(loaded.sessionId, "sess-1");
    assert.equal(loaded.items.some((i) => i.kind === "approval"), false);
    assert.equal(loaded.items.filter((i) => i.kind === "user").length, 2);
    assert.equal(loadChatSnapshot("u2"), null);
    clearChatSnapshot();
    assert.equal(loadChatSnapshot("u1"), null);
  });

  it("会話が空・セッションidが無い状態は控えない", () => {
    clearChatSnapshot();
    saveChatSnapshot("u1", initialChatState);
    saveChatSnapshot("u1", addNotice(initialChatState, "info", "x"));
    assert.equal(loadChatSnapshot("u1"), null);
  });
});
