/**
 * MCP（Streamable HTTP）の応答本文からJSON-RPCのメッセージを1つ取り出す（#573）。
 *
 * サーバーは `application/json` でも `text/event-stream` でも返してよい。SSEの場合は
 * `data:` 行をイベントごとに繋ぎ、`id` を持つ最後のメッセージ（＝要求への応答）を返す。
 * 途中に通知（`id` の無いメッセージ）が混ざっても読み飛ばす。DBにもネットワークにも触れない。
 */
export function readMcpBody(text: string, contentType: string | null): unknown {
  if (!(contentType ?? "").includes("text/event-stream")) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  const messages: unknown[] = [];
  for (const event of text.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (data.trim() === "") continue;
    try {
      messages.push(JSON.parse(data));
    } catch {
      // 読めないイベントは飛ばす（応答そのものが読めなければ最後にnullになる）。
    }
  }

  const responses = messages.filter(
    (message) => !!message && typeof message === "object" && "id" in (message as object),
  );
  return responses.at(-1) ?? null;
}
