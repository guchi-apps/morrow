import assert from "node:assert/strict";
import { test } from "node:test";

import { findUnsubscribeLink } from "../src/lib/mail/unsubscribe-core.ts";

test("URLに解除の語があるリンクを選ぶ", () => {
  const html = '<a href="https://example.com/top">Top</a><a href="https://example.com/unsubscribe?u=1&amp;t=2">here</a>';
  assert.equal(findUnsubscribeLink(html, null), "https://example.com/unsubscribe?u=1&t=2");
});

test("リンクの文言で選ぶ", () => {
  const html = '<a href="https://example.com/p/9"><span>配信停止</span>はこちら</a>';
  assert.equal(findUnsubscribeLink(html, null), "https://example.com/p/9");
});

test("https以外・認証情報つき・無関係なリンクは返さない", () => {
  assert.equal(findUnsubscribeLink('<a href="http://example.com/unsubscribe">x</a>', null), null);
  assert.equal(findUnsubscribeLink('<a href="javascript:unsubscribe()">x</a>', null), null);
  assert.equal(findUnsubscribeLink('<a href="https://u:p@example.com/unsubscribe">x</a>', null), null);
  assert.equal(findUnsubscribeLink('<a href="https://example.com/news">お得</a>', null), null);
});

test("HTMLが無ければテキストのURLから探す", () => {
  assert.equal(findUnsubscribeLink(null, "解除: https://example.com/optout/abc を開く"), "https://example.com/optout/abc");
  assert.equal(findUnsubscribeLink(null, null), null);
});
