/**
 * 道具が `isError` で返した結果から、画面に出してよい短い理由を取る（純粋。`test/mcp-tool-error.test.ts`）。
 *
 * - JSON（`structuredContent` か `content[].text`）に `reason` があればそれ
 * - **接続の権限（OAuthのscope）が足りずに断られた回**（#788）は、AIDEが `reason` の無いプレーンテキスト
 *   （「ツール X には tasks:write の認可が必要です。再接続して…」）で返す。理由が無いと画面は
 *   「時間をおいて試してください」になり、待っても直らない。繋ぎ直しを促す文に置き換える
 * - それ以外の本文・スタックは出さない
 */

export const REASON_LIMIT = 120;

export const MISSING_SCOPE_REASON = "接続にこの操作の許可がありません。設定の接続から繋ぎ直してください";

/** AIDE（`src/mcp/transport.ts`）が権限不足のときに返す文の形。 */
const MISSING_SCOPE_PATTERN = /の認可が必要です/;

function firstText(result: Record<string, unknown>): string | null {
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content.find((item): item is { text: string } => !!item && typeof (item as { text?: unknown }).text === "string")?.text;
  return text ?? null;
}

export function toolErrorReason(result: Record<string, unknown>): string | null {
  const text = firstText(result);
  let record: unknown = result.structuredContent;
  if (!record || typeof record !== "object") {
    try {
      record = text ? JSON.parse(text) : null;
    } catch {
      record = null;
    }
  }
  const reason = record && typeof record === "object" ? (record as { reason?: unknown }).reason : null;
  if (typeof reason === "string") {
    const flat = reason.replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim();
    if (flat !== "") return flat.slice(0, REASON_LIMIT);
  }
  if (text && MISSING_SCOPE_PATTERN.test(text)) return MISSING_SCOPE_REASON;
  return null;
}
