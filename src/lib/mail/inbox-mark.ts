import type { MailViewKey } from "./contract";

/**
 * 検索の対象。受信トレイ・未読・すべての表示からは、アーカイブ済みを含む「すべて」から探す（#1032）。
 * ゴミ箱の表示だけは従来どおりゴミ箱の中を探す（画面がゴミ箱の行として描くため）。
 * クライアントからも読むので、サーバー専用の `search.ts` ではなくここに置く（#1054）。
 */
export function searchViewFor(view: MailViewKey): MailViewKey {
  return view === "trash" ? "trash" : "all";
}

/**
 * 一覧の行に受信トレイの目印を出すか（#1033・#1054）。
 * 「すべて」表示は受信トレイとアーカイブ済みが混ざるので、そこだけ区別する。
 * 検索結果も「すべて」の範囲から探す（ゴミ箱を除く）ので、同じ目印を出す。
 * 受信トレイ表示は全部が受信トレイ、ゴミ箱・未読は目印の意味が変わるので出さない。
 */
export function showInboxMark(view: string, searching = false): boolean {
  if (searching) return view !== "trash";
  return view === "all";
}

/** アーカイブ済みの行を淡くするか。検索結果では淡くしない（目印だけ。#1054）。 */
export function dimArchivedRows(view: string, searching = false): boolean {
  return !searching && view === "all";
}

export function isInboxRow(labelIds: readonly string[]): boolean {
  return labelIds.includes("INBOX");
}
