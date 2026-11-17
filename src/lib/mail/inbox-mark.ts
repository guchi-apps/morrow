/**
 * 一覧の行に受信トレイの目印を出すか（#1033）。
 * 「すべて」表示は受信トレイとアーカイブ済みが混ざるので、そこだけ区別する。
 * 受信トレイ表示は全部が受信トレイ、ゴミ箱・未読は目印の意味が変わるので出さない。
 */
export function showInboxMark(view: string): boolean {
  return view === "all";
}

export function isInboxRow(labelIds: readonly string[]): boolean {
  return labelIds.includes("INBOX");
}
