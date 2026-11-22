import { after } from "next/server";
import { redirect } from "next/navigation";

import { MailAccountMenu } from "@/components/mail/mail-account-menu";
import { MailCheckButton } from "@/components/mail/mail-check-button";
import { MailCriteriaDialog } from "@/components/mail/mail-criteria-dialog";
import { MailCriteriaForm } from "@/components/mail/mail-criteria-form";
import { MailLearnedRules } from "@/components/mail/mail-learned-rules";
import { ArchivedList, type ArchivedGroup } from "@/components/mail/archived-list";
import { MailRows } from "@/components/mail/mail-rows";
import { MailSearch } from "@/components/mail/mail-search";
import { getCurrentUser } from "@/lib/auth-user";
import { jstDayKey, jstTimeLabel } from "@/lib/day-key";
import { getMail, listMailForPage } from "@/lib/mail/aide-client";
import { recentArchived } from "@/lib/mail/archive-log";
import { groupArchiveByDay } from "@/lib/mail/archive-log-core";
import {
  MAIL_FAILURE_MESSAGES,
  MAIL_PAGE_VIEWS,
  isMailPageViewKey,
  type MailListPage,
  type MailPageViewKey,
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
import { PullIndicator, PullToRefresh } from "@/components/mail/pull-to-refresh";

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
  const view: MailPageViewKey = isMailPageViewKey(query.view) ? query.view : "inbox";
  const archivedView = view === "archived";
  const filter = parseAccountFilter(query.acct);
  // URLへ載せる選択（既定のときは付けない）。表示切替・検索・ページ送りで引き継ぐ
  const account = filter.kind === "keys" ? filter.keys.join(",") : null;
  // 検索語（#998）。検索は画面（`MailSearch`）が `/api/mail/search` から段階ごとに取り、この下の一覧だけを差し替える。
  // サーバーが描くのは常に検索していない一覧（×で即座に戻すため。本文から戻ったときは画面が検索を取り直す）
  const q = (query.q ?? "").trim().slice(0, 200);

  const now = new Date();
  // 「最近のアーカイブ」（#1122）はAIDEの一覧ではなくMorrowの控えから作る。アカウントの絞り込み・検索は持たない
  const emptyPage: MailListPage = {
    owner: "",
    supportsLabels: false,
    partial: false,
    failedAccounts: [],
    accounts: null,
    labels: [],
    messages: [],
    nextPageToken: null,
    resultSizeEstimate: 0,
  };
  const result = view === "archived"
    ? ({ ok: true, value: emptyPage } as const)
    : await listMailForPage(user, { view, labelId: null, filter, q: "", pageToken: null });
  const archivedGroups: ArchivedGroup[] = archivedView ? await archivedGroupsFor(user, now) : [];
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
  const viewHref = (key: MailPageViewKey) => {
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
          searchable={!archivedView}
          showAccount={showAccounts && selected.length > 1}
          nowMs={now.getTime()}
          stickyClassName="sticky top-0 z-10 -mx-3.5 flex flex-col gap-2 border-b border-border bg-background px-3.5 pb-2.5 pt-3 md:-mx-7 md:px-7 md:pt-5"
          tabs={MAIL_PAGE_VIEWS.map((item) => ({ key: item.key, label: item.label, href: viewHref(item.key) }))}
          top={
            <p className="whitespace-nowrap text-right text-[0.625rem] leading-snug text-muted sm:text-[0.6875rem]">
              {checkedAt ? `${jstTimeLabel(checkedAt)}確認（15分ごとに確認）` : "まだ新着を確認していません"}
            </p>
          }
          // 「いま確認」のボタンはヘッダーへ。結果のメッセージだけがここ（固定部分の下）に出る
          below={
            <>
              <MailCheckButton />
              <PullIndicator />
            </>
          }
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
            {archivedView ? (
              archivedGroups.length === 0 ? (
                <p className="rounded-xl border border-border bg-surface px-4 py-3 text-xs leading-relaxed text-muted">
                  最近（7日以内）にMorrowでアーカイブしたメールはありません。アーカイブすると、ここからアーカイブした順に見返して受信トレイへ戻せます。
                </p>
              ) : (
                <ArchivedList groups={archivedGroups} back={back} />
              )
            ) : rows.length === 0 && !result.value.nextPageToken ? (
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

const archivedTime = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });

/** 最近のアーカイブ（#1122）の行を作る。控えは新しい順で、件名・差出人は1通ずつAIDEから取る（取れなかった行は件名なしで残す）。 */
async function archivedGroupsFor(user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>, now: Date): Promise<ArchivedGroup[]> {
  const entries = await recentArchived(user.id, now).catch(() => []);
  const loaded = await Promise.all(
    entries.map(async (entry) => {
      const mail = await getMail(user, entry.messageId).catch(() => null);
      const summary = mail && mail.ok ? mail.value.message : null;
      return {
        id: entry.messageId,
        archivedAt: entry.archivedAt,
        timeLabel: archivedTime.format(new Date(entry.archivedAt)),
        from: summary?.from ?? null,
        subject: summary ? summary.subject || "（件名なし）" : null,
      };
    }),
  );
  return groupArchiveByDay(loaded, now);
}
