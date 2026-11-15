import { modelFor } from "@/lib/chat-model-server";
import { runCodexRecorded } from "@/lib/codex-run";
import { jstDayKey } from "@/lib/day-key";

import type { AccountFilter } from "@/lib/mail/account-filter";
import { listMailForPage, type MailUser } from "@/lib/mail/aide-client";
import { acquireMailCodex, waitForMailCodex } from "@/lib/mail/codex-lock";
import { MAIL_FAILURE_MESSAGES, type MailSummary, type MailViewKey } from "@/lib/mail/contract";
import { decorateMailRows, type MailListRow } from "@/lib/mail/list-rows";
import {
  RANK_CANDIDATE_MAX,
  buildRankPrompt,
  buildSearchQueriesPrompt,
  parseRankReply,
  parseSearchQueries,
  type SearchEvent,
} from "@/lib/mail/search-core";

/**
 * メールのAI検索（#998）の本体。**サーバー専用。** 段階ごとの知らせ（`SearchEvent`）を順に積み、口（`/api/mail/search`）がNDJSONで流す。
 *
 * - 一覧の取得はすべて `listMailForPage()` → `listMail()` を通る（**持ち主の照合込み**。#683）
 * - Codex（用途「メールの判定」のモデル）は利用者ごとに同時1件（`codex-lock.ts`）。分析の先回りが走っていれば少し待ち、
 *   取れなければキーワードの結果だけで終える（`ai_unavailable`）
 * - 同じ条件の検索は、走っている1回を共有し、終わった結果は10分だけプロセス内に覚える（本文から戻るたびにAIを呼び直さない）。
 *   画面が途中で離れても最後まで走って覚える。DB・ログには件名などを残さない
 */

const QUERY_TIMEOUT_MS = 60_000;
const RANK_TIMEOUT_MS = 120_000;
const KEEP_MS = 10 * 60_000;
const MAX_RUNS = 30;
const LOCK_WAIT_MS = 1_000;
const LOCK_WAIT_TRIES = 20;

type Event = SearchEvent<MailListRow>;

type Run = {
  events: Event[];
  listeners: Set<(event: Event) => void>;
  finished: boolean;
  at: number;
};

// ページとRoute Handlerで別のモジュールを持つことがあるので、globalThisに置く（`list-cache.ts` と同じ）
const globalKey = "__morrowMailSearchRuns";
function runs(): Map<string, Run> {
  const g = globalThis as unknown as Record<string, Map<string, Run> | undefined>;
  return (g[globalKey] ??= new Map());
}

function prune(now: number) {
  const store = runs();
  for (const [key, run] of store) if (run.finished && now - run.at > KEEP_MS) store.delete(key);
  while (store.size > MAX_RUNS) {
    const oldest = [...store.entries()].find(([, run]) => run.finished);
    if (!oldest) break;
    store.delete(oldest[0]);
  }
}

export type MailSearchParams = { view: MailViewKey; filter: AccountFilter; account: string | null; q: string };

/**
 * 検索を始める（同じ条件が走っている・覚えていればそれを使う）。`listen` には、それまでの知らせを先に全部渡し、
 * 以後は届くたびに渡す。戻りは購読をやめる関数。
 */
export function subscribeMailSearch(user: MailUser, params: MailSearchParams, listen: (event: Event) => void): () => void {
  const now = Date.now();
  prune(now);
  const key = JSON.stringify([user.id, user.email ?? "", params.view, params.account ?? "", params.q]);
  const store = runs();
  let run = store.get(key);
  if (!run) {
    const created: Run = { events: [], listeners: new Set(), finished: false, at: now };
    run = created;
    store.set(key, created);
    const emit = (event: Event) => {
      created.events.push(event);
      for (const listener of created.listeners) listener(event);
    };
    void execute(user, params, emit)
      .catch((error) => {
        console.error("[aide-bot] メールのAI検索に失敗した", error instanceof Error ? error.message : error);
        emit({ type: "error", message: MAIL_FAILURE_MESSAGES.failed });
      })
      .finally(() => {
        created.finished = true;
        created.at = Date.now();
        emit({ type: "done" });
        created.listeners.clear();
        // 失敗・AIを使えなかった回は覚えない（もう一度検索すればやり直せる）
        if (created.events.some((event) => event.type === "error" || event.type === "ai_unavailable")) store.delete(key);
      });
  }
  for (const event of run.events) listen(event);
  if (run.finished) return () => undefined;
  const current = run;
  current.listeners.add(listen);
  return () => current.listeners.delete(listen);
}

async function acquireWithWait(userId: string, key: string): Promise<(() => void) | null> {
  const stopWaiting = waitForMailCodex(userId);
  try {
    for (let i = 0; i < LOCK_WAIT_TRIES; i += 1) {
      const release = acquireMailCodex(userId, { kind: "search", key });
      if (release) return release;
      await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_MS));
    }
    return null;
  } finally {
    stopWaiting();
  }
}

async function execute(user: MailUser, params: MailSearchParams, emit: (event: Event) => void): Promise<void> {
  const { view, filter, q } = params;
  const found = new Map<string, MailSummary>();

  /** 1つの条件で1ページ引き、まだ出していない行だけを返す。 */
  async function fetchNew(query: string) {
    const result = await listMailForPage(user, { view, labelId: null, filter, q: query, pageToken: null });
    if (!result.ok) return result;
    const fresh = result.value.messages.filter((message) => !found.has(message.id));
    for (const message of fresh) found.set(message.id, message);
    return { ok: true as const, partial: result.value.partial, rows: await decorateMailRows(user, fresh, false) };
  }

  // 1. 入力そのもののキーワード検索（即表示）
  const keyword = await fetchNew(q);
  if (!keyword.ok) {
    // キーワード検索ができない回は、AIの条件で引いても同じ理由で失敗する（未接続・持ち主違いなど）
    emit({ type: "error", message: MAIL_FAILURE_MESSAGES[keyword.kind] });
    return;
  }
  emit({ type: "keyword", rows: keyword.rows, partial: keyword.partial });

  // 2. AIに検索条件を作らせる
  const model = await modelFor(user.id, "mail");
  let queries: string[] | null = null;
  const queryLock = await acquireWithWait(user.id, `search:${q}`);
  if (!queryLock) {
    emit({ type: "ai_unavailable", reason: "メールのAIが別の処理を実行中のため、キーワードに一致したメールだけを出しています。" });
    return;
  }
  try {
    const result = await runCodexRecorded({
      userId: user.id,
      feature: "mail_search_query",
      label: "メール検索の条件づくり",
      model,
      prompt: buildSearchQueriesPrompt({ text: q, today: jstDayKey(new Date()) }),
      timeoutMs: QUERY_TIMEOUT_MS,
    });
    queries = parseSearchQueries(result.messages.at(-1) ?? result.text, q);
  } catch (error) {
    console.error("[aide-bot] メール検索の条件を作れなかった", error instanceof Error ? error.message : error);
  } finally {
    queryLock();
  }
  if (queries === null) {
    emit({ type: "ai_unavailable", reason: "AIで検索条件を作れなかったため、キーワードに一致したメールだけを出しています。" });
    return;
  }
  emit({ type: "queries", queries });

  // 3. 条件ごとに候補を足す（並行に引き、終わった条件から出す）
  await Promise.all(
    queries.map(async (query) => {
      try {
        const hits = await fetchNew(query);
        if (hits.ok) emit({ type: "hits", query, rows: hits.rows });
        else emit({ type: "query_failed", query });
      } catch {
        emit({ type: "query_failed", query });
      }
    }),
  );

  // 4. 候補をAIに並べ替えさせる
  const candidates = [...found.values()].slice(0, RANK_CANDIDATE_MAX);
  if (candidates.length === 0) return;
  emit({ type: "ranking", count: candidates.length });
  const rankLock = await acquireWithWait(user.id, `search-rank:${q}`);
  if (!rankLock) {
    emit({ type: "ai_unavailable", reason: "メールのAIが別の処理を実行中のため、近い順への並べ替えはしていません。" });
    return;
  }
  try {
    const result = await runCodexRecorded({
      userId: user.id,
      feature: "mail_search_rank",
      label: "メール検索の並べ替え",
      model,
      prompt: buildRankPrompt({ text: q, candidates }),
      timeoutMs: RANK_TIMEOUT_MS,
    });
    const ranks = parseRankReply(result.messages.at(-1) ?? result.text, candidates);
    if (!ranks || ranks.size === 0) {
      emit({ type: "ai_unavailable", reason: "AIの並べ替えを読み取れなかったため、見つかった順に出しています。" });
      return;
    }
    emit({ type: "ranked", ranks: [...ranks].map(([id, rank]) => ({ id, ...rank })) });
  } catch (error) {
    console.error("[aide-bot] メール検索の並べ替えに失敗した", error instanceof Error ? error.message : error);
    emit({ type: "ai_unavailable", reason: "AIの並べ替えに失敗したため、見つかった順に出しています。" });
  } finally {
    rankLock();
  }
}
