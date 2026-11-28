/**
 * 秘書の返信をマークダウンとして描く（#1203）。単体テストから実際の描画結果を確かめられるよう、
 * JSXを使わない `.ts` にしてある。
 *
 * 返信は受信メールなど外の文章に影響されうるので、HTMLは解釈せず（react-markdownの既定）、
 * 画像は読み込まず、押せるリンクは http(s) だけ。名前を付けたリンクには行き先のドメインを添える。
 * 唯一の例外はメールの本文の画面 `/mail/<id>`（#1218。`chatMailHref()`）。同じタブで開き、画面遷移はチャット側が受け持つ。
 */
import { createElement as h, memo, type ComponentProps, type ReactNode } from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";

import { remarkChatReply } from "@/lib/hermes/markdown-plugin";
import { chatMailHref } from "@/lib/mail/chat-link";

type HastNode = { type: string; value?: string; children?: HastNode[] };

function textOf(node: HastNode | undefined): string {
  if (!node) return "";
  return node.type === "text" ? (node.value ?? "") : (node.children ?? []).map(textOf).join("");
}

function decoded(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

/** 表示の文字がURLそのものでなければ、添えるドメインを返す。 */
function hostHint(href: string, label: string): string | null {
  const same = [href, decoded(href)].some((url) => url === label || url === `http://${label}`);
  if (same) return null;
  try {
    return new URL(href).hostname;
  } catch {
    return null;
  }
}

function Link({ href, children, node }: ComponentProps<"a"> & ExtraProps): ReactNode {
  const mail = href ? chatMailHref(href) : null;
  // `data-mail-link` はHTMLを解釈しないので返信の文からは付けられない。チャット側がこの印を見て画面遷移する
  if (mail) return h("a", { href: mail, "data-mail-link": "" }, children);
  if (!href || !/^https?:\/\//i.test(href)) return h("span", null, children);
  const host = hostHint(href, textOf(node as HastNode | undefined));
  return h(
    "span",
    null,
    h("a", { href, target: "_blank", rel: "noopener noreferrer" }, children),
    host ? h("span", { className: "chat-md-host" }, `（${host}）`) : null,
  );
}

const components: Components = {
  a: Link,
  // 参照形式の画像などが残っても、読み込みはしない
  img: ({ alt }) => h("span", null, alt ? `画像: ${alt}` : "画像"),
  table: ({ children }) => h("div", { className: "chat-md-scroll" }, h("table", null, children)),
};

/** `streaming` の間は末尾にカーソルを出す。経過秒の更新（1秒ごと）で解析し直さないよう memo にする。 */
export const ChatMarkdown = memo(function ChatMarkdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  return h(
    "div",
    { className: streaming ? "chat-md chat-md-streaming" : "chat-md" },
    // `~` 1個は打ち消し線にしない（「06:46~07:09」が消えるため）
    h(ReactMarkdown, { remarkPlugins: [[remarkGfm, { singleTilde: false }], remarkChatReply], components }, text),
  );
});
