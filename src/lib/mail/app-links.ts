import { ASSET_MANAGER_ORIGIN } from "@/lib/mail/payment-receipt";
import type { SuggestKind } from "@/lib/mail/suggest-core";
import { ASSET_MANAGER_SUBSCRIPTIONS_URL } from "@/lib/mail/subscription-link";

/**
 * 提案の種類ごとに、記録の持ち主（台帳）のアプリの画面（#766）。ハーフモーダルの「○○で開く」に使う。
 * **入力値は引き継がない**（受け側がクエリで入力画面を埋める口は各アプリに無い）。サブスクだけは `subscriptionLink()` が値を載せる（#709）。
 * 家計簿は主ボタンが確認待ちのレシートを作ってその編集画面を開く（`receiptUrl()`。#781）。ここはレシートを作れないときの逃げ道。
 * クライアントからもimportするので依存を持たない。
 */
export const FLOW_APP_LINKS: Record<SuggestKind, { label: string; url: string }> = {
  payment: { label: "Asset Managerの家計簿連携を開く", url: `${ASSET_MANAGER_ORIGIN}/receipts` },
  subscription: { label: "Asset Managerのサブスク一覧を開く", url: ASSET_MANAGER_SUBSCRIPTIONS_URL },
  task: { label: "DaySpanのタスクを開く", url: "https://dayspan.gucchii.com/tasks" },
  event: { label: "詳細をDaySpanで開く（繰り返し・通知など）", url: "https://dayspan.gucchii.com/calendar" },
};

/**
 * 紐づけた予定・タスクの「開く」の行き先（#914）。予定は `/calendar?date=YYYY-MM-DD` にして、アプリ（YoteiFlow）の
 * Universal Linkで当日のカレンダーを開かせる（`date` の形は受け側も検証する）。日付が無い・形が違えば従来の `/calendar`。
 * タスクの `/tasks` はYoteiFlowのUniversal Linkの許可パスに無く、アプリ側が対応するまでSafariで開く。
 */
export function linkAppUrl(kind: "task" | "event", dateText: string | null): string {
  const base = FLOW_APP_LINKS[kind].url;
  if (kind === "event" && dateText && /^\d{4}-\d{2}-\d{2}$/.test(dateText)) return `${base}?date=${dateText}`;
  return base;
}
