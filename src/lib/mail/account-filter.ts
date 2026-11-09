import { isMailAccountKey, mailAccountKeyOf, type MailAccount, type MailListPage, type MailSummary } from "@/lib/mail/contract";

/**
 * メール一覧のアカウント絞り込み（#829）。複数選択で、URLの `?acct=main,formal` に載せる。
 * `?acct` が無い間は既定（サブを除く）。DBにもCookieにも持たない。
 * 純粋な関数だけ（Prismaに触れない）。
 */

/** 既定で表示しないアカウントの鍵。 */
export const DEFAULT_HIDDEN_ACCOUNT_KEY = "sub";

/** 追加取得の上限と、絞った後に最低でも欲しい件数。 */
export const FILL_MAX_EXTRA_PAGES = 3;
export const FILL_TARGET_COUNT = 10;

/** AIDEが `accounts` を返さず、1アカウントだけ取った回の名前の補い（鍵は `contract.ts` の固定色の表と同じ）。 */
export const KNOWN_ACCOUNT_NAMES: Record<string, string> = { main: "メイン", sub: "サブ", formal: "フォーマル" };

export type AccountFilter = { kind: "default" } | { kind: "keys"; keys: string[] };

/** `?acct`（カンマ区切り）を読む。鍵として読めない値は捨て、1つも残らなければ既定。 */
export function parseAccountFilter(raw: unknown): AccountFilter {
  if (typeof raw !== "string") return { kind: "default" };
  const keys = [...new Set(raw.split(",").filter(isMailAccountKey))].slice(0, 8);
  return keys.length > 0 ? { kind: "keys", keys } : { kind: "default" };
}

/** 全アカウントの鍵のうち、いま選ばれているもの。 */
export function selectedAccountKeys(filter: AccountFilter, allKeys: string[]): string[] {
  if (filter.kind === "keys") return filter.keys;
  const visible = allKeys.filter((key) => key !== DEFAULT_HIDDEN_ACCOUNT_KEY);
  return visible.length > 0 ? visible : allKeys;
}

/** チップを1つ押した後の選択。最後の1つはオフにできない（変えない）。 */
export function toggleAccountKey(selected: string[], allKeys: string[], key: string): string[] {
  const next = selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key];
  if (next.length === 0) return selected;
  return allKeys.filter((k) => next.includes(k)).concat(next.filter((k) => !allKeys.includes(k)));
}

/** 選択をURLへ載せる値。既定と同じ並びなら null（`?acct` を付けない）。 */
export function accountParamOf(selected: string[], allKeys: string[]): string | null {
  const def = selectedAccountKeys({ kind: "default" }, allKeys);
  const same = def.length === selected.length && def.every((k) => selected.includes(k));
  return same ? null : selected.join(",");
}

/** 行が選択に含まれるか。鍵の取れない行（単一アカウントの構成）は常に出す。 */
export function messageAllowed(filter: AccountFilter, message: Pick<MailSummary, "id">): boolean {
  const key = mailAccountKeyOf(message.id);
  if (key === null) return true;
  return filter.kind === "keys" ? filter.keys.includes(key) : key !== DEFAULT_HIDDEN_ACCOUNT_KEY;
}

/** 1アカウントだけの選択なら、その鍵（AIDEの `acct` へそのまま渡せる）。 */
export function singleAccountKey(filter: AccountFilter): string | null {
  return filter.kind === "keys" && filter.keys.length === 1 ? filter.keys[0]! : null;
}

/** 表示用のアカウント一覧。AIDEの一覧があればそれ、無ければ行からの推定に、選択中・既知の鍵を足す。 */
export function mergeAccounts(base: MailAccount[], extraKeys: string[]): MailAccount[] {
  const list = [...base];
  for (const key of extraKeys) {
    if (!list.some((item) => item.key === key)) list.push({ key, name: KNOWN_ACCOUNT_NAMES[key] ?? key });
  }
  return list;
}

type Outcome<T> = { ok: true; value: T } | { ok: false; kind: string; message: string | null };

/**
 * 全アカウントの一覧を取り、選択で絞る。絞った件数が足りない間は次のページを足す（上限あり）。
 * `fetchPage` は `pageToken` を受けて1ページ取る関数。`accounts` は絞る前の全行から決める。
 */
export async function fetchFilteredPage<E extends Outcome<MailListPage>>(
  fetchPage: (pageToken: string | null) => Promise<E>,
  filter: AccountFilter,
  pageToken: string | null,
  inferAccounts: (messages: MailSummary[]) => MailAccount[],
): Promise<E> {
  const first = await fetchPage(pageToken);
  if (!first.ok) return first;

  let page = first.value;
  let allRows = page.messages;
  let kept = allRows.filter((m) => messageAllowed(filter, m));
  let partial = page.partial;
  const failed = new Set(page.failedAccounts);
  let extra = 0;
  while (kept.length < FILL_TARGET_COUNT && page.nextPageToken && extra < FILL_MAX_EXTRA_PAGES) {
    const next = await fetchPage(page.nextPageToken);
    if (!next.ok) break; // 足りないまま出す（一覧そのものは取れている）
    extra += 1;
    page = next.value;
    allRows = allRows.concat(page.messages);
    kept = kept.concat(page.messages.filter((m) => messageAllowed(filter, m)));
    partial = partial || page.partial;
    for (const name of page.failedAccounts) failed.add(name);
  }

  const accounts = first.value.accounts ?? inferAccounts(allRows);
  return { ...first, value: { ...first.value, messages: kept, accounts, nextPageToken: page.nextPageToken, partial, failedAccounts: [...failed] } };
}
