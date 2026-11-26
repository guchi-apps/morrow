import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ChatMarkdown } from "../src/components/hermes/chat-markdown.ts";

// 実際の描画結果で固定する（#1203）。外側の <div class="chat-md"> は外して比べる
const render = (text: string) =>
  renderToStaticMarkup(createElement(ChatMarkdown, { text })).replace(/^<div class="chat-md">|<\/div>$/g, "");

test("見出し・箇条書き・表を装飾し、表は横スクロールの枠に入れる", () => {
  const html = render("### タスク\n- 一つ\n\n| 期限 | タスク |\n|---|---|\n| 12月9日 | 券を使う |");
  assert.match(html, /<h3>タスク<\/h3>/);
  assert.match(html, /<li>一つ<\/li>/);
  assert.match(html, /<div class="chat-md-scroll"><table>/);
});

test("記号で終わる太字の後ろに文字が続いても太字になる", () => {
  assert.equal(
    render("13時は**組合イベント（守口市）**です。**28日（土）**も"),
    "<p>13時は<strong>組合イベント（守口市）</strong>です。<strong>28日（土）</strong>も</p>",
  );
});

test("組にならない ** とコードの中は変えない", () => {
  assert.equal(render("2**10 は"), "<p>2**10 は</p>");
  assert.equal(render("`**（a）**x`"), "<p><code>**（a）**x</code></p>");
});

test("~ 1個は打ち消し線にしない", () => {
  assert.equal(render("06:46~07:09 と 10:30~11:30"), "<p>06:46~07:09 と 10:30~11:30</p>");
});

test("改行は残る", () => {
  assert.equal(render("一行目\n二行目"), "<p>一行目<br/>\n二行目</p>");
});

test("本文のURLは日本語の手前で切る", () => {
  const html = render("詳しくはhttps://example.com/aです。 www.example.jpへ");
  assert.match(html, /<a href="https:\/\/example\.com\/a" [^>]*>https:\/\/example\.com\/a<\/a><\/span>です。/);
  assert.match(html, /<a href="http:\/\/www\.example\.jp" [^>]*>www\.example\.jp<\/a><\/span>へ/);
  assert.doesNotMatch(html, /chat-md-host/);
});

test("名前を付けたリンクには行き先のドメインを添える", () => {
  const html = render("[天気予報](https://weather.example.jp/1)");
  assert.match(html, />天気予報<\/a><span class="chat-md-host">（weather\.example\.jp）<\/span>/);
});

test("http(s)以外のリンクは押せない", () => {
  for (const text of ["[a](javascript:alert(1))", "[a](/auth/signout)", "[a](mailto:a@example.com)"]) {
    assert.doesNotMatch(render(text), /<a /, text);
  }
});

test("画像は読み込まない（直接・参照形式・リンクの中）", () => {
  for (const text of [
    "![図](https://example.com/x.png)",
    "![図][r]\n\n[r]: https://example.com/x.png",
    "[![図](https://example.com/x.png)](https://example.com/)",
  ]) {
    const html = render(text);
    assert.doesNotMatch(html, /<img|rel="preload"/, text);
    assert.match(html, /画像: 図/, text);
    assert.doesNotMatch(html, /<a [^>]*>(?:(?!<\/a>).)*<a /, text);
  }
});

test("HTMLは解釈しない", () => {
  assert.doesNotMatch(render('<img src="https://example.com/x.png"> <script>alert(1)</script>'), /<img|<script/);
});
