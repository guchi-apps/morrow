import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { clearSessionId, loadSessionId, saveSessionId, type StorageLike } from "@/lib/hermes/session-memory";
import { initialChatState, restoreFromHistory } from "@/lib/hermes/stream-view";

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
});
