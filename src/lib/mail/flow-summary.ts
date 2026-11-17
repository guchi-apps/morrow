import { itemsTotal } from "@/lib/mail/payment-receipt";
import type { Suggestion } from "@/lib/mail/suggest-core";

/**
 * 登録した内容の1行の要約（#750）。`flow-record-core.ts` から切り出した（#1051）——画面（クライアント）でも、
 * 提案の行が登録済みかを内容で見分けるのに使うため。`node:crypto` などサーバー専用のものを持ち込まない。
 */

const SUMMARY_LIMIT = 300;

function md(date: string | null): string | null {
  const m = date ? /^\d{4}-(\d{2})-(\d{2})$/.exec(date) : null;
  return m ? `${Number(m[1])}/${Number(m[2])}` : null;
}

/** 購入日の控え。受信日で補った日付は購入日と区別する（#903）。 */
function dayLabel(f: { date: string | null; dateEstimated?: boolean }): string | null {
  const day = md(f.date);
  return day && f.dateEstimated ? `${day}（受信日）` : day;
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
      return join([f.place ?? label, f.place ? label : null, total !== null ? `${total.toLocaleString("ja-JP")}円` : null, dayLabel(f)]);
    }
    case "subscription": {
      const f = suggestion.fields;
      const unit = f.currency === "USD" ? "ドル" : "円";
      return join([f.name, f.amount !== null ? `${f.amount.toLocaleString("ja-JP")}${unit}` : null, f.cycle === "YEARLY" ? "毎年" : "毎月"]);
    }
    case "task": {
      const f = suggestion.fields;
      return join([f.title, f.due ? `期限 ${md(f.due)}${f.dueTime ? ` ${f.dueTime}` : ""}` : null]);
    }
    case "event": {
      const f = suggestion.fields;
      const time = f.startTime ? `${f.startTime}${f.endTime ? `–${f.endTime}` : ""}` : null;
      return join([f.title, [md(f.date), time].filter(Boolean).join(" ") || null]);
    }
    // 追跡は配送会社のページを開くだけで控えを残さない（#972）。ここへは来ない
    case "tracking":
      return "";
    // 紐づけは `MailLink` が控えを持つので、`MailFlowRecord` へは残さない（#1029）
    case "link":
      return "";
  }
}

/** 登録済みの内容の鍵（種類＋登録時点の要約）。サーバーは控え（`MailFlowRecord`）から、画面は提案の行から同じ鍵を作って照らす（#1051）。 */
export function registeredKeyOf(kind: string, summary: string): string {
  return `${kind}\n${summary}`;
}

/** 控えの種類の見た目。クライアント（一覧の行など）から値で使うので、`node:crypto` を引く `flow-record-core.ts` から移した（#1051の計画レビュー）。 */
export const FLOW_KIND_META = {
  payment: { icon: "🧾", label: "家計簿" },
  subscription: { icon: "🔁", label: "サブスク" },
  task: { icon: "📌", label: "タスク" },
  event: { icon: "📅", label: "予定" },
  /** 一覧を開いただけ。登録済みに見せない（Morrowは登録できず、押したかどうかしか分からない） */
  subscription_opened: { icon: "🔁", label: "サブスク一覧を開いた" },
} as const;
