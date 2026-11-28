import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { chatLink, EMPTY_CHAT_LINK, publishChatLink, resetChatLink, subscribeChatLink } from "@/lib/hermes/chat-link";

describe("chat-link（#1228）", () => {
  it("画面が置いた状態をメニューが受け取り、離れると空に戻る", () => {
    const opened: string[] = [];
    let notified = 0;
    const unsubscribe = subscribeChatLink(() => {
      notified += 1;
    });
    publishChatLink({ currentId: "a", busy: false, refreshKey: "a:idle", open: (id) => opened.push(id) });
    chatLink().open?.("b");
    assert.equal(chatLink().currentId, "a");
    assert.deepEqual(opened, ["b"]);

    resetChatLink();
    assert.equal(chatLink(), EMPTY_CHAT_LINK);
    assert.equal(notified, 2);

    unsubscribe();
    resetChatLink();
    assert.equal(notified, 2);
  });
});
