import { registeredKeyOf, summarizeSuggestion } from "@/lib/mail/flow-summary";
import type { SuggestKind, Suggestion } from "@/lib/mail/suggest-core";

/**
 * 提案の行をまとめて出す（#1051）ときの、DB・画面に触れない部分。`test/mail-flow-group.test.ts` が固定する。
 * クライアントからもimportする（サーバー専用のものを持ち込まない）。
 */

/** まとめて登録できる種類。家計簿（Asset Managerを別タブで開く）・サブスク・追跡（ページを開くだけ）・紐づけは行から1件ずつ。 */
export const BULK_KINDS: readonly SuggestKind[] = ["task", "event"];

export function isBulkKind(kind: SuggestKind): boolean {
  return BULK_KINDS.includes(kind);
}

const SHORT_LABELS: Record<SuggestKind, string> = {
  payment: "家計簿",
  subscription: "サブスク",
  task: "タスク",
  event: "予定",
  tracking: "追跡",
  link: "紐づけ",
};

/** 「候補 3件（タスク2・予定1）」。種類は最初に出た順。 */
export function groupHeading(cards: readonly Suggestion[]): string {
  const counts = new Map<SuggestKind, number>();
  for (const card of cards) counts.set(card.kind, (counts.get(card.kind) ?? 0) + 1);
  const parts = [...counts].map(([kind, n]) => `${SHORT_LABELS[kind]}${n}`);
  return `候補 ${cards.length}件（${parts.join("・")}）`;
}

/**
 * おすすめの印を付ける行の位置。推奨は種類で返る（`SuggestResult.recommended`）ので、同じ種類が複数あれば先頭の1行だけに付ける。
 * 候補が1件だけのときは付けない（`onlyWhenMany`。メールへの指示の返事の従来の挙動）。
 */
export function recommendedIndex(cards: readonly Suggestion[], recommended: SuggestKind | null, onlyWhenMany = false): number {
  if (recommended === null || (onlyWhenMany && cards.length < 2)) return -1;
  return cards.findIndex((card) => card.kind === recommended);
}

/**
 * 控え（`MailFlowRecord`）から見て登録済みか。同じ種類の行が1つだけなら従来どおり種類で見る（シートで値を直してから登録しても印が付く）。
 * 同じ種類が複数並ぶときは内容（要約）で見る——種類で見ると1件の登録で全部が登録済みに見える。
 */
export function isRegisteredByRecord(card: Suggestion, cards: readonly Suggestion[], registeredKinds: readonly string[], registeredKeys: readonly string[]): boolean {
  const sameKind = cards.filter((c) => c.kind === card.kind).length;
  if (sameKind <= 1) return registeredKinds.includes(card.kind);
  return registeredKeys.includes(registeredKeyOf(card.kind, summarizeSuggestion(card)));
}

export type BulkItemResult = { kind: SuggestKind; ok: boolean };

/** まとめて登録した結果の1行（「2件を登録しました（タスク2）」「3件中2件を登録しました。1件は登録できませんでした」）。 */
export function bulkResultText(results: readonly BulkItemResult[]): { text: string; error: boolean } {
  const done = results.filter((r) => r.ok);
  const failed = results.length - done.length;
  if (done.length === 0) return { text: `${results.length}件とも登録できませんでした。各行の理由を確かめてください。`, error: true };
  const counts = new Map<SuggestKind, number>();
  for (const r of done) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
  const detail = [...counts].map(([kind, n]) => `${SHORT_LABELS[kind]}${n}`).join("・");
  if (failed === 0) return { text: `${done.length}件を登録しました（${detail}）。`, error: false };
  return { text: `${results.length}件中${done.length}件を登録しました（${detail}）。${failed}件は登録できませんでした。`, error: true };
}
