/**
 * メール本文への指示（#784）の入力欄の上に並べる「頼み方の候補」（#1138）。
 * モデルは呼ばない固定の一覧で、AI分析の提案の種類に合う候補を先頭へ寄せるだけ。
 * 純粋な関数（`test/mail-chat-examples.test.ts`）。クライアントからもimportするので値だけを持つ。
 */

export type ChatExampleKind = "payment" | "subscription" | "task" | "event" | "tracking" | "link";

type Example = { text: string; kinds: ChatExampleKind[] };

/** 既定の並び（提案が無いときはこの順）。 */
const EXAMPLES: Example[] = [
  { text: "支払期限はいつ？", kinds: ["payment", "subscription"] },
  { text: "返信の文を考えて", kinds: [] },
  { text: "予定にして", kinds: ["event"] },
  { text: "タスクにする", kinds: ["task"] },
  { text: "家計簿に追加して", kinds: ["payment"] },
  { text: "要点を3行で", kinds: [] },
  { text: "いつまでに対応が必要？", kinds: ["task", "event"] },
  { text: "返信は必要？", kinds: [] },
];

/** 提案の種類に合う候補を先頭へ（元の並びは保つ）。重複・種類の重複は無視する。 */
export function orderChatExamples(kinds: readonly string[]): string[] {
  const wanted = new Set(kinds);
  const matched = EXAMPLES.filter((example) => example.kinds.some((kind) => wanted.has(kind)));
  const rest = EXAMPLES.filter((example) => !matched.includes(example));
  return [...matched, ...rest].map((example) => example.text);
}
