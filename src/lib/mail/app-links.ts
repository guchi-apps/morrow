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
  // 追跡は番号入りのURL（`trackingUrl()`）を主ボタンに使う。ここは使わない（型を揃えるだけ）
  tracking: { label: "日本郵便の追跡サービスを開く", url: "https://trackings.post.japanpost.jp/services/srv/search/" },
  // 紐づけ先を開く行き先は `linkAppUrl()`（日付つき）を使う。ここは型を揃えるだけ（#1029）
  link: { label: "DaySpanのカレンダーを開く", url: "https://dayspan.gucchii.com/calendar" },
};

/**
 * 紐づけた予定・タスクの「開く」の行き先（#914）。予定は `/calendar?date=YYYY-MM-DD` にして、アプリ（YoteiFlow）の
 * Universal Linkで当日のカレンダーを開かせる（`date` の形は受け側も検証する）。日付が無い・形が違えば従来の `/calendar`。
 * **タスクの `/tasks` はYoteiFlowのUniversal Linkの許可パス（`/calendar` だけ。本番のAASAで確認）に無く、Safariで開いてしまう**（#940）。
 * カレンダーはタスクも出すので、日付（期限・予定日）があるタスクは予定と同じく `/calendar?date=` でアプリへ渡す。
 * 日付の無いタスクは `/tasks` のまま（アプリ側のAASAへ `/tasks` が入るまでSafariで開く）。
 */
export function linkAppUrl(kind: "task" | "event", dateText: string | null): string {
  const validDate = dateText !== null && /^\d{4}-\d{2}-\d{2}$/.test(dateText);
  if (validDate) return `${FLOW_APP_LINKS.event.url}?date=${dateText}`;
  return FLOW_APP_LINKS[kind].url;
}

/**
 * 作ったタスクを開く行き先（#1022）。YoteiFlowにタスク個別を開く口は無いので、タスクも出る日のカレンダーを開く。
 * 日付は予定日→期限の順（どちらも `YYYY-MM-DD` でなければ無いものとして `linkAppUrl()` が `/tasks` へ落とす）。
 */
export function taskOpenUrl(fields: { planned?: string | null; due?: string | null }): string {
  return linkAppUrl("task", taskOpenDate(fields));
}

function taskOpenDate(fields: { planned?: string | null; due?: string | null }): string | null {
  const valid = (d: string | null | undefined) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
  return valid(fields.planned) ?? valid(fields.due);
}

/**
 * 「タスクを開く」が予定フローのアプリで開くか（#1030）。日付があれば `/calendar?date=`（Universal Link対象）でアプリへ渡る。
 * 日付が無いと `/tasks` でSafariが開くので、画面はアプリで開くと案内しない。
 */
export function taskOpensInApp(fields: { planned?: string | null; due?: string | null }): boolean {
  return taskOpenDate(fields) !== null;
}
