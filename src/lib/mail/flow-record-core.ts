import { createHash } from "node:crypto";

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
      return join([f.place ?? f.name, f.place ? f.name : null, f.amount !== null ? `${f.amount.toLocaleString("ja-JP")}円` : null, md(f.date)]);
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
} as const;

export const FLOW_STATUS_LABELS: Record<FlowRecordStatus, string> = {
  done: "登録済み",
  pending: "取り込み済み（確認待ち）",
  duplicate: "登録済み（重複を検出）",
  opened: "一覧を開いた（登録は未確認）",
};
