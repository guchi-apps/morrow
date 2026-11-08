import type { SuggestKind } from "@/lib/mail/suggest-core";
import { ASSET_MANAGER_SUBSCRIPTIONS_URL } from "@/lib/mail/subscription-link";

/**
 * 提案の種類ごとに、記録の持ち主（台帳）のアプリの画面（#766）。ハーフモーダルの「○○で開く」に使う。
 * **入力値は引き継がない**（受け側がクエリで入力画面を埋める口は各アプリに無い）。サブスクだけは `subscriptionLink()` が値を載せる（#709）。
 * クライアントからもimportするので依存を持たない。
 */
export const FLOW_APP_LINKS: Record<SuggestKind, { label: string; url: string }> = {
  payment: { label: "Asset Managerの家計簿連携を開く", url: "https://asset.gucchii.com/receipts" },
  subscription: { label: "Asset Managerのサブスク一覧を開く", url: ASSET_MANAGER_SUBSCRIPTIONS_URL },
  task: { label: "DaySpanのタスクを開く", url: "https://dayspan.gucchii.com/tasks" },
  event: { label: "DaySpanのカレンダーを開く", url: "https://dayspan.gucchii.com/calendar" },
};
