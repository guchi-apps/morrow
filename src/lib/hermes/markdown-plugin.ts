/**
 * チャットの返信をマークダウンで描くときの補正（#1203）。mdast（構文木）だけを触る純粋関数で、
 * 依存は足していない。標準の変換のままだと日本語の返信が崩れる次の点を直す。
 *
 * - GFMのURL自動リンクが後ろの日本語まで飲み込む → `splitLinks()`（#810）で切り直す
 * - `**…（茨木市）**です` のように記号で終わる太字は CommonMark では太字にならない → 残った `**` を組にする
 * - 段落内の改行が消える → 改行要素にする
 * - 画像は開いただけで外部へ通信する → 画像にせず、押すリンクにする
 */
import { splitLinks } from "@/lib/hermes/linkify";

type Node = {
  type: string;
  value?: string;
  url?: string;
  alt?: string | null;
  children?: Node[];
  position?: { start: { offset?: number } };
};

const text = (value: string): Node => ({ type: "text", value });

export function remarkChatReply() {
  return (tree: unknown, file: { value?: unknown }) => {
    walk(tree as Node, String(file.value ?? ""), false);
  };
}

function walk(node: Node, source: string, insideLink: boolean) {
  if (!node.children) return;
  const isLink = insideLink || node.type === "link" || node.type === "linkReference";

  let children = node.children.flatMap((child): Node[] => {
    if (child.type === "image") {
      const label = child.alt ? `画像: ${child.alt}` : "画像";
      return isLink ? [text(label)] : [{ type: "link", url: child.url ?? "", children: [text(label)] }];
    }
    if (child.type === "link" && isBareUrl(child, source)) return splitBareUrl(child);
    walk(child, source, isLink);
    return [child];
  });

  children = mergeText(children);
  children = pairStrong(children);
  node.children = children.flatMap((child) => (child.type === "text" ? splitLines(child.value ?? "") : [child]));
}

/** `[名前](URL)` や `<URL>` ではなく、本文に書かれたURLがそのままリンクになったもの。 */
function isBareUrl(link: Node, source: string): boolean {
  if (link.children?.length !== 1 || link.children[0].type !== "text") return false;
  const offset = link.position?.start.offset;
  return offset === undefined || (source[offset] !== "[" && source[offset] !== "<");
}

function splitBareUrl(link: Node): Node[] {
  const raw = link.children?.[0].value ?? "";
  if (/^https?:\/\//i.test(raw)) {
    return splitLinks(raw).map((part) =>
      part.type === "link" ? { type: "link", url: part.href, children: [text(part.text)] } : text(part.text),
    );
  }
  // `www.` で始まるもの。URLに使えない文字（日本語）の手前で切る。メールアドレスなどはそのまま
  if (!/^www\./i.test(raw)) return [link];
  const head = (/^[\x21-\x7e]+/.exec(raw)?.[0] ?? "").replace(/[.,;:!?'*]+$/, "");
  const rest = raw.slice(head.length);
  const result: Node[] = [{ type: "link", url: `http://${head}`, children: [text(head)] }];
  return rest ? [...result, text(rest)] : result;
}

function mergeText(nodes: Node[]): Node[] {
  const merged: Node[] = [];
  for (const node of nodes) {
    const last = merged.at(-1);
    if (node.type === "text" && last?.type === "text") merged[merged.length - 1] = text(`${last.value}${node.value}`);
    else merged.push(node);
  }
  return merged;
}

/** 変換されずに文字として残った `**` を、同じ行の中で組にして太字にする。インラインコードの中は触らない。 */
function pairStrong(nodes: Node[]): Node[] {
  if (!nodes.some((node) => node.type === "text" && node.value?.includes("**"))) return nodes;

  const MARK: Node = { type: "mark" };
  const tokens: Node[] = nodes.flatMap((node) => {
    if (node.type !== "text") return [node];
    return (node.value ?? "")
      .split("**")
      .flatMap((piece, index) => [...(index > 0 ? [MARK] : []), ...(piece ? [text(piece)] : [])]);
  });

  const result: Node[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] !== MARK) {
      result.push(tokens[i]);
      continue;
    }
    const end = tokens.indexOf(MARK, i + 1);
    const inner = end > i + 1 ? tokens.slice(i + 1, end) : [];
    if (canBeStrong(inner)) {
      result.push({ type: "strong", children: inner });
      i = end;
    } else {
      result.push(text("**"));
    }
  }
  return mergeText(result);
}

/** 中身があり、端が空白でなく、行をまたがない。 */
function canBeStrong(inner: Node[]): boolean {
  const first = inner[0];
  const last = inner.at(-1);
  if (!first || !last) return false;
  if (first.type === "text" && /^\s/.test(first.value ?? "")) return false;
  if (last.type === "text" && /\s$/.test(last.value ?? "")) return false;
  return !inner.some((node) => node.type === "break" || (node.type === "text" && node.value?.includes("\n")));
}

function splitLines(value: string): Node[] {
  return value
    .split("\n")
    .flatMap((line, index) => [...(index > 0 ? [{ type: "break" }] : []), ...(line ? [text(line)] : [])]);
}
