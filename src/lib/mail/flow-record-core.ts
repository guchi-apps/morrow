import { createHash } from "node:crypto";

import { registeredKeyOf } from "@/lib/mail/flow-summary";
import type { FlowOutcome } from "@/lib/mail/suggest-core";

/**
 * メールから登録した内容の控え（#750）のうち、DBに触れない部分。`test/mail-flow-record.test.ts` が固定する。
 * 控えは**登録時点の要約**で、台帳の記録の複製の正ではない（メール本文・差出人・件名は載せない）。
 */

export type FlowRecordStatus = "done" | "pending" | "duplicate" | "opened";

export { registeredKeyOf, summarizeSuggestion } from "@/lib/mail/flow-summary";

export function contentKeyOf(summary: string): string {
  return createHash("sha1").update(summary).digest("hex");
}

/** 記録に残す状態。失敗した実行は残さない（null）。 */
export function recordStatusOf(outcome: FlowOutcome): FlowRecordStatus | null {
  return outcome.status === "failed" ? null : outcome.status;
}

export const FLOW_KIND_META = {
  payment: { icon: "🧾", label: "家計簿" },
  subscription: { icon: "🔁", label: "サブスク" },
  task: { icon: "📌", label: "タスク" },
  event: { icon: "📅", label: "予定" },
  /** 一覧を開いただけ。登録済みに見せない（Morrowは登録できず、押したかどうかしか分からない） */
  subscription_opened: { icon: "🔁", label: "サブスク一覧を開いた" },
} as const;

export const FLOW_STATUS_LABELS: Record<FlowRecordStatus, string> = {
  done: "登録済み",
  pending: "取り込み済み（確認待ち）",
  duplicate: "登録済み（重複を検出）",
  opened: "一覧を開いた（登録は未確認）",
};

/**
 * 提案の行の印の材料（#821）。家計簿（payment）の pending（確認待ちレシートを作った）と duplicate（取り込み済みのレシートがある）は、
 * Asset Managerで確定したかをMorrowは知らないので、どちらも「登録済み」にしない。完了（done）の控えが同じ種類にあれば登録済みが勝つ。
 * duplicate は確定済みの場合もあるため、「確認待ち」とは言わず「取り込み済み」と出す。
 */
export type ReceiptState = "pending" | "duplicate";

export function flowRowStates(records: { kind: string; status: string; summary?: string }[]): { registeredKinds: string[]; registeredKeys: string[]; receiptState: ReceiptState | null } {
  const registeredKinds = new Set<string>();
  // 内容（種類＋要約）ごとの登録済み（#1051）。同じ種類の提案が複数並ぶとき、種類だけでは1件の登録で全部が登録済みに見える
  const registeredKeys = new Set<string>();
  let receiptState: ReceiptState | null = null;
  for (const r of records) {
    if (r.status === "opened") continue;
    if (r.kind === "payment" && (r.status === "pending" || r.status === "duplicate")) {
      if (r.status === "pending" || receiptState === null) receiptState = r.status;
      continue;
    }
    if (r.status === "pending") continue;
    registeredKinds.add(r.kind);
    if (r.summary) registeredKeys.add(registeredKeyOf(r.kind, r.summary));
  }
  return { registeredKinds: [...registeredKinds], registeredKeys: [...registeredKeys], receiptState: registeredKinds.has("payment") ? null : receiptState };
}

/** 控えの一覧に出す状態の文。家計簿の重複は確定済みとは限らないので「登録済み」と書かない。 */
export function flowStatusLabel(kind: string, status: string): string | undefined {
  if (kind === "payment" && status === "duplicate") return "取り込み済み（確定はAsset Managerで確認）";
  return FLOW_STATUS_LABELS[status as FlowRecordStatus];
}
