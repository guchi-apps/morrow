import Link from "next/link";
import { after } from "next/server";
import { redirect } from "next/navigation";

import { MailAccountMenu } from "@/components/mail/mail-account-menu";
import { MailCheckButton } from "@/components/mail/mail-check-button";
import { MailCriteriaDialog } from "@/components/mail/mail-criteria-dialog";
import { MailCriteriaForm } from "@/components/mail/mail-criteria-form";
import { MailLearnedRules } from "@/components/mail/mail-learned-rules";
import { elapsedLabel } from "@/components/mail/mail-format";
import { MailRows } from "@/components/mail/mail-rows";
import { MailSearch } from "@/components/mail/mail-search";
import { getCurrentUser } from "@/lib/auth-user";
import { jstDayKey, jstTimeLabel } from "@/lib/day-key";
import { listMailForPage } from "@/lib/mail/aide-client";
import {
  MAIL_FAILURE_MESSAGES,
  MAIL_VIEWS,
  isMailViewKey,
  type MailViewKey,
} from "@/lib/mail/contract";
import {
  KNOWN_ACCOUNT_NAMES,
  accountParamOf,
  mergeAccounts,
  parseAccountFilter,
  selectedAccountKeys,
  singleAccountKey,
  toggleAccountKey,
} from "@/lib/mail/account-filter";
import { onlyInbox } from "@/lib/mail/archived-memory";
import { deleteAnalyses } from "@/lib/mail/analysis-store";
import { deleteListSummaries } from "@/lib/mail/list-summary";
import { decorateMailRows } from "@/lib/mail/list-rows";
import { DEFAULT_MAIL_CRITERIA } from "@/lib/mail/triage-core";
import { normalizeLearnedRules } from "@/lib/mail/learn-core";
import { PullToRefresh } from "@/components/mail/pull-to-refresh";
import { cn } from "@/lib/utils";

// メールは開くたびにAIDEから取る（Morrowは保存しない）。
export const dynamic = "force-dynamic";

export const metadata = { title: "メール" };

type Props = {
  searchParams: Promise<{ view?: string; acct?: string; q?: string }>;
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
  const filter = parseAccountFilter(query.acct);
  // URLへ載せる選択（既定のときは付けない）。表示切替・検索・ページ送りで引き継ぐ
  const account = filter.kind === "keys" ? filter.keys.join(",") : null;
  // 検索語（#998）。検索は画面（`MailSearch`）が `/api/mail/search` から段階ごとに取り、この下の一覧だけを差し替える。
  // サーバーが描くのは常に検索していない一覧（×で即座に戻すため。本文から戻ったときは画面が検索を取り直す）
  const q = (query.q ?? "").trim().slice(0, 200);

  const now = new Date();
  const result = await listMailForPage(user, { view, labelId: null, filter, q: "", pageToken: null });
  // 受信トレイでは、INBOXラベルの無い（アーカイブ済みの）メールを出さない（#795）
  const inboxView = view === "inbox";
  // INBOXの無いメール（アーカイブ・ゴミ箱）の要約は消す（#851。Gmail側の直接操作の取りこぼしを拾う）
  if (result.ok) {
    const outside = result.value.messages.filter((m) => !m.labelIds.includes("INBOX")).map((m) => m.id);
    if (outside.length > 0) {
      after(() => deleteListSummaries(user.id, outside).catch(() => undefined));
      after(() => deleteAnalyses(user.id, outside).catch(() => undefined));
    }
  }
  if (result.ok && inboxView) result.value.messages = onlyInbox(result.value.messages);
  // 1ページ目だけを取って出す。続きは画面のスクロールで `/api/mail/list` から足す（#887）。
  // 一覧の要約は受信トレイ表示のときだけ。無い分は裏で作り、画面が取り直す
  const rows = result.ok ? await decorateMailRows(user, result.value.messages, inboxView) : [];

  // アカウントのチップ（#711・#829）。AIDEが `accounts` を返せばそれ、無ければ絞る前の全行から推定した一覧。
  // 1アカウントだけ取った回は他のアカウントが分からないので、既知の鍵（メイン・サブ・フォーマル）を足して、押して戻せるようにする
  const accounts = (() => {
    if (!result.ok) return [];
    const base = result.value.accounts ?? [];
    const extra = singleAccountKey(filter) ? [...(filter.kind === "keys" ? filter.keys : []), ...Object.keys(KNOWN_ACCOUNT_NAMES)] : filter.kind === "keys" ? filter.keys : [];
    return base.length > 0 || extra.length > 0 ? mergeAccounts(base, extra) : base;
  })();
  const allKeys = accounts.map((item) => item.key);
  const selected = selectedAccountKeys(filter, allKeys);
  const showAccounts = result.ok && accounts.length > 1;
  /** チップを押した後のURL。表示と検索語は引き継ぎ、ページ位置は捨てる。最後の1つを外す操作は今の選択のまま。 */
  const accountHref = (key: string) => {
    const params = new URLSearchParams();
    if (view !== "inbox") params.set("view", view);
    const acct = accountParamOf(toggleAccountKey(selected, allKeys, key), allKeys);
    if (acct) params.set("acct", acct);
    return `/mail${params.size > 0 ? `?${params}` : ""}`;
  };
  const viewHref = (key: MailViewKey) => {
    const params = new URLSearchParams();
    if (key !== "inbox") params.set("view", key);
    if (account) params.set("acct", account);
    return `/mail${params.size > 0 ? `?${params}` : ""}`;
  };

  const self = new URLSearchParams();
  if (view !== "inbox") self.set("view", view);
  if (account) self.set("acct", account);
  const back = `/mail${self.size > 0 ? `?${self}` : ""}`;

  // メールに付けた印から学んだ傾向（#833）
  const learnedRules = normalizeLearnedRules(user.mailLearnedRules, jstDayKey(now));

  const checkedAt = user.mailCheckedAt;

  return (
    <PullToRefresh className="mobile-tab-pad min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[900px] flex-col gap-3.5 px-3.5 pb-4 md:px-7 md:pb-6">
        {/* ヘッダー右上のアイコン（いま確認 → アカウント → お知らせする基準。並びは order で固定）。中身はポータルで置き場へ入る */}
        {showAccounts && result.ok && (
          <MailAccountMenu
            items={accounts.map((item) => ({ key: item.key, name: item.name, on: selected.includes(item.key), href: accountHref(item.key) }))}
            failedNames={result.value.failedAccounts}
          />
        )}
        <MailCriteriaDialog learnedCount={learnedRules.length} custom={Boolean(user.mailCriteria)}>
          <MailCriteriaForm initial={user.mailCriteria} defaultCriteria={DEFAULT_MAIL_CRITERIA} />
          <MailLearnedRules initial={learnedRules} />
        </MailCriteriaDialog>

        {/* 表示切替と検索は上に固定し、その下の一覧だけを流す（#997）。検索すると一覧だけが結果に変わる（#998） */}
        <MailSearch
          key={`${view}\u0000${account ?? ""}`}
          initialQuery={q}
          view={view}
          account={account}
          labels={result.ok ? result.value.labels : []}
          supportsLabels={result.ok ? result.value.supportsLabels : false}
          inTrash={view === "trash"}
          showAccount={showAccounts && selected.length > 1}
          nowMs={now.getTime()}
          stickyClassName="sticky top-0 z-10 -mx-3.5 flex flex-col gap-2 border-b border-border bg-background px-3.5 pb-2.5 pt-3 md:-mx-7 md:px-7 md:pt-5"
          top={
          <div className="flex items-center gap-2">
            <nav aria-label="表示するメール" className="flex shrink-0 flex-nowrap gap-1 text-xs sm:gap-1.5">
              {MAIL_VIEWS.map((item) => {
                const on = item.key === view;
                return (
                  <Link
                    key={item.key}
                    href={viewHref(item.key)}
                    aria-current={on ? "page" : undefined}
                    className={cn(
                      "whitespace-nowrap rounded-full border px-2.5 py-1.5 transition-colors sm:px-3",
                      on ? "border-foreground bg-foreground text-background" : "border-border bg-surface hover:bg-rail-active",
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            <p className="ml-auto min-w-0 text-right text-[0.625rem] leading-snug text-muted sm:text-[0.6875rem]">
              {checkedAt ? (
                <>
                  <span className="sm:hidden">
                    {jstTimeLabel(checkedAt)}確認（{elapsedLabel(checkedAt, now)}）
                    <br />
                    15分ごとに自動
                  </span>
                  <span className="hidden sm:inline">
                    最終確認 {jstTimeLabel(checkedAt)}（{elapsedLabel(checkedAt, now)}）・15分ごとに自動で確認
                  </span>
                </>
              ) : (
                "まだ新着を確認していません"
              )}
            </p>
          </div>
          }
          // 「いま確認」のボタンはヘッダーへ。結果のメッセージだけがここ（固定部分の下）に出る
          below={<MailCheckButton />}
        >
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
            {rows.length === 0 && !result.value.nextPageToken ? (
              <p className="rounded-xl border border-border bg-surface px-4 py-3 text-xs text-muted">
                {result.value.partial ? "取得できたアカウントには、表示するメールがありません。" : "メールはありません。"}
              </p>
            ) : (
              <MailRows
                key={back}
                messages={rows}
                initialNextToken={result.value.nextPageToken}
                listQuery={{ view, acct: account, q: "" }}
                labels={result.value.labels}
                supportsLabels={result.value.supportsLabels}
                inTrash={view === "trash"}
                showAccount={showAccounts && selected.length > 1}
                nowMs={now.getTime()}
                back={back}
                inboxView={inboxView}
              />
            )}
            {result.value.resultSizeEstimate > 0 && <p className="text-xs text-muted">約{result.value.resultSizeEstimate}通</p>}
          </>
        )}
        </MailSearch>
      </div>
    </PullToRefresh>
  );
}
