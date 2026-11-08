import { createHash } from "node:crypto";

import { itemsTotal } from "@/lib/mail/payment-receipt";
import type { FlowOutcome, Suggestion } from "@/lib/mail/suggest-core";

/**
 * メールから登録した内容の控え（#750）のうち、DBに触れない部分。`test/mail-flow-record.test.ts` が固定する。
 * 控えは**登録時点の要約**で、台帳の記録の複製の正ではない（メール本文・差出人・件名は載せない）。
 */

export type FlowRecordStatus = "done" | "pending" | "duplicate" | "opened";

const SUMMARY_LIMIT = 300;

function md(date: string | null): string | null {
  const m = date ? /^\d{4}-(\d{2})-(\d{2})$/.exec(date) : null;
  return m ? `${Number(m[1])}/${Number(m[2])}` : null;
}

function join(parts: (string | null | undefined)[]): string {
  return parts.filter((p): p is string => Boolean(p)).join(" / ").slice(0, SUMMARY_LIMIT);
}

/** 登録した内容を1行にまとめる。 */
export function summarizeSuggestion(suggestion: Suggestion): string {
  switch (suggestion.kind) {
    case "payment": {
      const f = suggestion.fields;
      // 品目に分かれていれば、品名の代わりに先頭の品目と件数（#781）。金額が無ければ品目の合計
      const label = f.items.length > 0 ? `${f.items[0]!.name}${f.items.length > 1 ? ` ほか${f.items.length - 1}件` : ""}` : f.name || null;
      const total = f.amount ?? itemsTotal(f.items);
      return join([f.place ?? label, f.place ? label : null, total !== null ? `${total.toLocaleString("ja-JP")}円` : null, md(f.date)]);
    }
    case "subscription": {
      const f = suggestion.fields;
      const unit = f.currency === "USD" ? "ドル" : "円";
      return join([f.name, f.amount !== null ? `${f.amount.toLocaleString("ja-JP")}${unit}` : null, f.cycle === "YEARLY" ? "毎年" : "毎月"]);
    }
    case "task": {
      const f = suggestion.fields;
      return join([f.title, f.due ? `期限 ${md(f.due)}` : null]);
    }
    case "event": {
      const f = suggestion.fields;
      const time = f.startTime ? `${f.startTime}${f.endTime ? `–${f.endTime}` : ""}` : null;
      return join([f.title, [md(f.date), time].filter(Boolean).join(" ") || null]);
    }
  }
}

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

export function flowRowStates(records: { kind: string; status: string }[]): { registeredKinds: string[]; receiptState: ReceiptState | null } {
  const registeredKinds = new Set<string>();
  let receiptState: ReceiptState | null = null;
  for (const r of records) {
    if (r.status === "opened") continue;
    if (r.kind === "payment" && (r.status === "pending" || r.status === "duplicate")) {
      if (r.status === "pending" || receiptState === null) receiptState = r.status;
      continue;
    }
    if (r.status === "pending") continue;
    registeredKinds.add(r.kind);
  }
  return { registeredKinds: [...registeredKinds], receiptState: registeredKinds.has("payment") ? null : receiptState };
}

/** 控えの一覧に出す状態の文。家計簿の重複は確定済みとは限らないので「登録済み」と書かない。 */
export function flowStatusLabel(kind: string, status: string): string | undefined {
  if (kind === "payment" && status === "duplicate") return "取り込み済み（確定はAsset Managerで確認）";
  return FLOW_STATUS_LABELS[status as FlowRecordStatus];
}
