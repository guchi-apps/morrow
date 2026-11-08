import assert from "node:assert/strict";
import { test } from "node:test";

import { splitLinks } from "@/lib/hermes/linkify";

const links = (text: string) => splitLinks(text).filter((p) => p.type === "link").map((p) => p.text);

test("文章だけならそのまま1つ", () => {
  assert.deepEqual(splitLinks("こんにちは"), [{ type: "text", text: "こんにちは" }]);
  assert.deepEqual(splitLinks(""), []);
});

test("URLの前後の文章を保つ", () => {
  assert.deepEqual(splitLinks("見て https://example.com/a です"), [
    { type: "text", text: "見て " },
    { type: "link", text: "https://example.com/a", href: "https://example.com/a" },
    { type: "text", text: " です" },
  ]);
});

test("日本語の句読点・括弧・文末記号はURLに含めない", () => {
  assert.deepEqual(links("https://example.com/a。次"), ["https://example.com/a"]);
  assert.deepEqual(links("「https://example.com/a」"), ["https://example.com/a"]);
  assert.deepEqual(links("（https://example.com/a）"), ["https://example.com/a"]);
  assert.deepEqual(links("see https://example.com/a."), ["https://example.com/a"]);
  assert.deepEqual(links("(https://example.com/a)"), ["https://example.com/a"]);
  assert.deepEqual(links("https://example.com/a?x=1&y=2, next"), ["https://example.com/a?x=1&y=2"]);
});

test("URLの中の括弧は対応していれば残す", () => {
  assert.deepEqual(links("https://ja.wikipedia.org/wiki/A_(b)"), ["https://ja.wikipedia.org/wiki/A_(b)"]);
});

test("複数のURL", () => {
  assert.deepEqual(links("https://a.example/ と http://b.example/x"), ["https://a.example/", "http://b.example/x"]);
});

test("http(s)以外・スキームだけはリンクにしない", () => {
  assert.deepEqual(links("javascript:alert(1)"), []);
  assert.deepEqual(links("ftp://example.com"), []);
  assert.deepEqual(links("https://"), []);
  assert.deepEqual(links("https://。"), []);
});
