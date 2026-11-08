import { Search } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { MailAccountTabs } from "@/components/mail/mail-account-tabs";
import { MailCheckButton } from "@/components/mail/mail-check-button";
import { MailCriteriaForm } from "@/components/mail/mail-criteria-form";
import { elapsedLabel } from "@/components/mail/mail-format";
import { MailLabelFilter } from "@/components/mail/mail-label-filter";
import { MailRows } from "@/components/mail/mail-rows";
import { getCurrentUser } from "@/lib/auth-user";
import { jstTimeLabel } from "@/lib/day-key";
import { listMail } from "@/lib/mail/aide-client";
import {
  MAIL_FAILURE_MESSAGES,
  MAIL_VIEWS,
  inferMailAccounts,
  isMailAccountKey,
  isMailLabelId,
  isMailPageToken,
  isMailViewKey,
  type MailViewKey,
} from "@/lib/mail/contract";
import { flowKindsFor } from "@/lib/mail/flow-record";
import { neededTriages } from "@/lib/mail/triage";
import { DEFAULT_MAIL_CRITERIA } from "@/lib/mail/triage-core";
import { cn } from "@/lib/utils";

// メールは開くたびにAIDEから取る（Morrowは保存しない）。
export const dynamic = "force-dynamic";

export const metadata = { title: "メール" };

type Props = {
  searchParams: Promise<{ view?: string; label?: string; acct?: string; q?: string; page?: string }>;
};

/**
 * メールの一覧（#683）。中身はAIDEの `/api/mail/messages` から取り、**持ち主本人のときだけ**出す
 * （照合は `listMail()`。一致しなければ中身を捨てて `not_owner`）。
 *
 * 一部のアカウントが読めなかった回（`partial`）は赤い帯で知らせ、「メールが無い」とは読ませない。
 */
export default async function MailPage({ searchParams }: Props) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const query = await searchParams;
  const view: MailViewKey = isMailViewKey(query.view) ? query.view : "inbox";
  const labelId = isMailLabelId(query.label) ? query.label : null;
  const account = isMailAccountKey(query.acct) ? query.acct : null;
  const q = (query.q ?? "").trim().slice(0, 200);
  const pageToken = isMailPageToken(query.page) ? query.page : null;

  const now = new Date();
  const result = await listMail(user, { view, labelId, account, q, pageToken });
  const listedIds = result.ok ? result.value.messages.map((m) => m.id) : [];
  const [notified, flowKinds] = result.ok ? await Promise.all([neededTriages(user.id, listedIds), flowKindsFor(user.id, listedIds)]) : [new Map(), new Map<string, string[]>()];

  const self = new URLSearchParams();
  if (labelId) self.set("label", labelId);
  else if (view !== "inbox") self.set("view", view);
  if (account) self.set("acct", account);
  if (q) self.set("q", q);
  if (pageToken) self.set("page", pageToken);
  const back = `/mail${self.size > 0 ? `?${self}` : ""}`;

  // アカウントのタブ。AIDEが `accounts` を返せばそれを使い、無ければ表示中の行から推定する（#711）。
  // 推定は絞り込み中や行が無いアカウントで欠けうるので、絞り込み中のアカウントは必ず出して「すべて」へ戻れるようにする
  const accounts = (() => {
    if (!result.ok) return [];
    const list = result.value.accounts ?? inferMailAccounts(result.value.messages);
    return account && !list.some((item) => item.key === account) ? [...list, { key: account, name: account }] : list;
  })();
  const showAccounts = result.ok && (accounts.length > 1 || account !== null);
  /** タブの切り替え先。表示と検索語は引き継ぎ、ラベル（アカウントごと）とページ位置は捨てる。 */
  const accountHref = (key: string | null) => {
    const params = new URLSearchParams();
    if (view !== "inbox") params.set("view", view);
    if (key) params.set("acct", key);
    if (q) params.set("q", q);
    return `/mail${params.size > 0 ? `?${params}` : ""}`;
  };
  const viewHref = (key: MailViewKey) => {
    const params = new URLSearchParams();
    if (key !== "inbox") params.set("view", key);
    if (account) params.set("acct", account);
    return `/mail${params.size > 0 ? `?${params}` : ""}`;
  };

  const heading = labelId
    ? (result.ok ? result.value.labels.find((label) => label.id === labelId)?.name : null) ?? "ラベル"
    : MAIL_VIEWS.find((item) => item.key === view)!.label;

  const nextHref = (() => {
    if (!result.ok || !result.value.nextPageToken) return null;
    const params = new URLSearchParams(self);
    params.set("page", result.value.nextPageToken);
    return `/mail?${params}`;
  })();
  const firstHref = (() => {
    if (!pageToken) return null;
    const params = new URLSearchParams(self);
    params.delete("page");
    return `/mail${params.size > 0 ? `?${params}` : ""}`;
  })();

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[900px] flex-col gap-3.5 px-3.5 py-4 md:px-7 md:py-6">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-base font-bold tracking-tight">{heading}</h2>
          <span className="text-[0.6875rem] text-muted">
            {user.mailCheckedAt
              ? `最終確認 ${jstTimeLabel(user.mailCheckedAt)}（${elapsedLabel(user.mailCheckedAt, now)}）・15分ごとに自動で確認`
              : "まだ新着を確認していません"}
          </span>
        </div>

        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <p className="text-[0.6875rem] leading-relaxed text-muted md:pt-2">新着のうち必要なものだけを通知でお知らせします。</p>
          <MailCheckButton className="md:min-w-[220px] md:items-end" />
        </div>

        <details className="group rounded-xl border border-border bg-surface">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
            <svg
              viewBox="0 0 24 24"
              className="size-4 shrink-0 text-accent transition-transform group-open:rotate-90"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
            <span className="text-[0.8125rem] font-bold">お知らせする基準</span>
            <span className="ml-auto text-[0.6875rem] text-muted">{user.mailCriteria ? "設定済み・変更する" : "既定の基準・変更する"}</span>
          </summary>
          <div className="border-t border-border px-4 py-3.5">
            <MailCriteriaForm initial={user.mailCriteria} defaultCriteria={DEFAULT_MAIL_CRITERIA} />
          </div>
        </details>

        {showAccounts && result.ok && (
          <MailAccountTabs accounts={accounts} current={account} hrefFor={accountHref} failedNames={result.value.failedAccounts} />
        )}

        <nav aria-label="表示するメール" className="flex flex-wrap gap-1.5 text-xs">
          {MAIL_VIEWS.map((item) => {
            const on = !labelId && item.key === view;
            return (
              <Link
                key={item.key}
                href={viewHref(item.key)}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "rounded-full border px-3 py-1.5 transition-colors",
                  on ? "border-foreground bg-foreground text-background" : "border-border bg-surface hover:bg-rail-active",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <form action="/mail" method="get" role="search" className="flex min-w-0 flex-1 items-center gap-1.5 rounded-[9px] border border-border bg-surface px-2.5">
            <Search className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
            {!labelId && view !== "inbox" && <input type="hidden" name="view" value={view} />}
            {labelId && <input type="hidden" name="label" value={labelId} />}
            {account && <input type="hidden" name="acct" value={account} />}
            <input
              type="search"
              name="q"
              defaultValue={q}
              maxLength={200}
              placeholder="メールを検索"
              aria-label="メールを検索"
              className="min-w-0 flex-1 bg-transparent py-1.5 text-xs outline-none"
            />
          </form>
          {result.ok && result.value.supportsLabels && <MailLabelFilter labels={result.value.labels} current={labelId} account={account} />}
        </div>

        {!result.ok ? (
          <p role="alert" className="rounded-[10px] border border-danger/30 bg-danger-surface px-3.5 py-2.5 text-xs leading-relaxed text-danger">
            {MAIL_FAILURE_MESSAGES[result.kind]}
          </p>
        ) : (
          <>
            {result.value.partial && (
              <p role="alert" className="rounded-[10px] border border-danger/30 bg-danger-surface px-3.5 py-2.5 text-xs leading-relaxed text-danger">
                {result.value.failedAccounts.length > 0
                  ? `一部のアカウント（${result.value.failedAccounts.join("、")}）を取得できませんでした。`
                  : "一部のアカウントを取得できませんでした。"}
                一覧に欠けがあります。時間をおいて読み込み直してください。
              </p>
            )}
            {result.value.messages.length === 0 ? (
              <p className="rounded-xl border border-border bg-surface px-4 py-3 text-xs text-muted">
                {result.value.partial
                  ? "取得できたアカウントには、表示するメールがありません。"
                  : q
                    ? "検索に一致するメールはありません。"
                    : "メールはありません。"}
              </p>
            ) : (
              <MailRows
                messages={result.value.messages.map((message) => ({ ...message, notified: notified.has(message.id), flowKinds: flowKinds.get(message.id) ?? [] }))}
                labels={result.value.labels}
                supportsLabels={result.value.supportsLabels}
                inTrash={!labelId && view === "trash"}
                showAccount={showAccounts && !account}
                nowMs={now.getTime()}
                back={back}
              />
            )}
            <div className="flex items-center justify-between text-xs text-muted">
              {firstHref ? (
                <Link href={firstHref} className="underline">
                  ← 最初のページ
                </Link>
              ) : (
                <span>{result.value.resultSizeEstimate > 0 ? `1ページ目・約${result.value.resultSizeEstimate}通` : ""}</span>
              )}
              {nextHref && (
                <Link href={nextHref} className="rounded-[9px] border border-border bg-surface px-3 py-1.5 text-foreground hover:bg-rail-active">
                  次へ →
                </Link>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
