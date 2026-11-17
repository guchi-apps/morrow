"use client";

import { Search, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";

import type { MailLabel } from "@/lib/mail/contract";
import type { MailListRow } from "@/lib/mail/list-rows";
import type { SearchEvent } from "@/lib/mail/search-core";
import { SEARCH_LEVEL_LABELS, SEARCH_LEVEL_SHOWN, orderByRank, type SearchLevel, type SearchRank } from "@/lib/mail/search-order";
import { cn } from "@/lib/utils";
import Link from "next/link";

import { MailRows, type MailRowAnnotation } from "./mail-rows";
import { MailRowsSkeleton } from "./mail-skeleton";
import { MailViewPendingContext } from "./mail-view-tabs";

/** 入力の上限（文字）。`search-core.ts` の `SEARCH_TEXT_LIMIT` と同じ（プロンプトの文面をクライアントへ持ち込まないため値だけ揃える）。 */
const TEXT_LIMIT = 200;

type Props = {
  /** URLの `?q=`（本文から戻ったとき・再読み込みのとき）。 */
  initialQuery: string;
  view: string;
  account: string | null;
  labels: MailLabel[];
  supportsLabels: boolean;
  inTrash: boolean;
  showAccount: boolean;
  nowMs: number;
  /** 上に固定する帯（#997）のクラス。検索欄はこの帯の末尾に入る。 */
  stickyClassName: string;
  /** 表示切替のタブ。検索結果を出している間は薄くして押せなくする（#1054）。 */
  tabs: { key: string; label: string; href: string }[];
  /** 固定する帯の中、タブの右に置くもの（最終確認など）。 */
  top: ReactNode;
  /** 固定する帯のすぐ下に置くもの（「いま確認」の結果など）。 */
  below?: ReactNode;
  /** 検索していないときの一覧（サーバーで描いたもの）。 */
  children: ReactNode;
};

/**
 * メールの検索欄と、検索結果への一覧の差し替え（#998）。Enterで画面全体を読み込み直さず、この下の一覧だけを結果に変える。
 * URLの `?q=` は書き換えるだけ（遷移しない）。×・空で送ると、サーバーで描いた元の一覧へすぐ戻る。
 */
export function MailSearch({ initialQuery, view, account, labels, supportsLabels, inTrash, showAccount, nowMs, stickyClassName, tabs, top, below, children }: Props) {
  const [text, setText] = useState(initialQuery);
  const [active, setActive] = useState(initialQuery);
  // 同じ語で送り直したときも結果を取り直す（覚えた結果があればすぐ返る）
  const [nonce, setNonce] = useState(0);
  // サーバーから最後に受け取った `?q=`。この値が変わったとき（別の `?q=` で開き直した・取り直した）だけ検索を合わせる。
  // 自分で送った検索はURLを `replaceState` で書き換えるだけでサーバーの値は変わらないので、ここでは比べない
  // （以前は送った語と比べていたため、送った直後に古い値〔空〕へ戻され、入力が消えて検索もされなかった。#1014）
  const [serverQuery, setServerQuery] = useState(initialQuery);
  if (serverQuery !== initialQuery) {
    setServerQuery(initialQuery);
    if (initialQuery !== active) {
      setText(initialQuery);
      setActive(initialQuery);
    }
  }

  function apply(next: string) {
    const q = next.trim().slice(0, TEXT_LIMIT);
    setActive(q);
    const params = new URLSearchParams(window.location.search);
    if (q) params.set("q", q);
    else params.delete("q");
    const search = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}`);
  }

  const back = useMemo(() => {
    const params = new URLSearchParams();
    if (view !== "inbox") params.set("view", view);
    if (account) params.set("acct", account);
    if (active) params.set("q", active);
    return `/mail${params.size > 0 ? `?${params}` : ""}`;
  }, [view, account, active]);

  // 表示切替を押した直後（#1053）。新しいviewで描き直されると `key` ごと作り直されて消える。
  // 遷移が失敗・中断して届かない場合に更新中のまま残らないよう、一定時間で戻す
  const [pendingView, setPendingView] = useState<string | null>(null);
  useEffect(() => {
    if (pendingView === null) return;
    const timer = setTimeout(() => setPendingView(null), 20000);
    return () => clearTimeout(timer);
  }, [pendingView]);
  const switching = pendingView !== null && pendingView !== view;

  return (
    <MailViewPendingContext.Provider value={{ pending: pendingView, setPending: setPendingView }}>
      <div className={stickyClassName}>
        <div className="flex items-center gap-2">
          <nav aria-label="表示するメール" className={cn("flex shrink-0 flex-nowrap gap-1 text-xs transition-opacity sm:gap-1.5", active && "opacity-40")}>
            {tabs.map((item) => {
              const on = item.key === view;
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  aria-current={on ? "page" : undefined}
                  aria-disabled={active ? true : undefined}
                  tabIndex={active ? -1 : undefined}
                  onClick={(event) => {
                    // 検索結果を出している間は切り替えない。先に×で検索をやめてもらう（#1054）
                    if (active) event.preventDefault();
                  }}
                  className={cn(
                    "whitespace-nowrap rounded-full border px-2.5 py-1.5 transition-colors sm:px-3",
                    on ? "border-foreground bg-foreground text-background" : "border-border bg-surface",
                    active ? "cursor-default" : !on && "hover:bg-rail-active",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          {top}
        </div>
        <form
          role="search"
          // 読み込み途中（ハイドレーション前）に送られたときは、従来どおり `/mail?q=` へ遷移する
          action="/mail"
          method="get"
          onSubmit={(event) => {
            event.preventDefault();
            apply(text);
            setNonce((n) => n + 1);
            (event.currentTarget.elements.namedItem("q") as HTMLInputElement | null)?.blur();
          }}
          className="flex min-w-0 items-center gap-1.5 rounded-[9px] border border-border bg-surface px-2.5 focus-within:border-accent"
        >
          <Search className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
          {view !== "inbox" && <input type="hidden" name="view" value={view} />}
          {account && <input type="hidden" name="acct" value={account} />}
          <input
            type="search"
            name="q"
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={TEXT_LIMIT}
            enterKeyHint="search"
            placeholder="メールを検索（AIが似たメールも探します）"
            aria-label="メールを検索"
            className="min-w-0 flex-1 bg-transparent py-1.5 text-xs outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {(text || active) && (
            <button
              type="button"
              aria-label="検索をやめる"
              onClick={() => {
                setText("");
                apply("");
              }}
              className="grid size-6 shrink-0 place-items-center rounded-md text-muted hover:bg-rail-active"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          )}
        </form>
      </div>
      {below}

      {switching ? (
        <MailRowsSkeleton />
      ) : active ? (
        <MailSearchResults
          key={`${view}\u0000${account ?? ""}\u0000${active}\u0000${nonce}`}
          q={active}
          view={view}
          account={account}
          back={back}
          labels={labels}
          supportsLabels={supportsLabels}
          inTrash={inTrash}
          showAccount={showAccount}
          nowMs={nowMs}
        />
      ) : (
        children
      )}
    </MailViewPendingContext.Provider>
  );
}

type QueryState = { query: string; status: "run" | "done" | "failed"; count: number };

type State = {
  rows: MailListRow[];
  /** 行ごとに、AIの検索語で見つかった場合のその条件（キーワード一致は無し）。 */
  foundBy: Record<string, string>;
  keywordDone: boolean;
  queries: QueryState[] | null;
  ranking: boolean;
  ranks: Record<string, { level: SearchLevel; reason: string }> | null;
  notice: string | null;
  error: string | null;
  partial: boolean;
  done: boolean;
  /** 利用者が×で中断した（#1062）。見つかった候補は残し、並べ替えはしない。 */
  cancelled: boolean;
};

const initialState: State = {
  rows: [],
  foundBy: {},
  keywordDone: false,
  queries: null,
  ranking: false,
  ranks: null,
  notice: null,
  error: null,
  partial: false,
  done: false,
  cancelled: false,
};

type Action = SearchEvent<MailListRow> | { type: "connection_lost" } | { type: "cancel" };

function addRows(rows: MailListRow[], more: MailListRow[]): MailListRow[] {
  const seen = new Set(rows.map((row) => row.id));
  return [...rows, ...more.filter((row) => !seen.has(row.id))];
}

function reduce(state: State, action: Action): State {
  switch (action.type) {
    case "keyword":
      return { ...state, keywordDone: true, rows: addRows(state.rows, action.rows), partial: action.partial };
    case "queries":
      return { ...state, queries: action.queries.map((query) => ({ query, status: "run", count: 0 })) };
    case "hits": {
      const foundBy = { ...state.foundBy };
      for (const row of action.rows) foundBy[row.id] ??= action.query;
      return {
        ...state,
        rows: addRows(state.rows, action.rows),
        foundBy,
        queries: state.queries?.map((item) => (item.query === action.query ? { ...item, status: "done", count: action.rows.length } : item)) ?? null,
      };
    }
    case "query_failed":
      return {
        ...state,
        queries: state.queries?.map((item) => (item.query === action.query ? { ...item, status: "failed" } : item)) ?? null,
      };
    case "ranking":
      return { ...state, ranking: true };
    case "ranked":
      return { ...state, ranking: false, ranks: Object.fromEntries(action.ranks.map(({ id, level, reason }) => [id, { level, reason }])) };
    case "ai_unavailable":
      return { ...state, ranking: false, notice: action.reason };
    case "error":
      return { ...state, error: action.message };
    case "done":
      return { ...state, ranking: false, done: true };
    case "cancel":
      return state.done ? state : { ...state, ranking: false, done: true, cancelled: true };
    case "connection_lost":
      return state.done ? state : { ...state, ranking: false, done: true, error: state.error ?? "通信が途切れました。もう一度検索してください。" };
  }
}

function MailSearchResults({
  q,
  view,
  account,
  back,
  labels,
  supportsLabels,
  inTrash,
  showAccount,
  nowMs,
}: {
  q: string;
  view: string;
  account: string | null;
  back: string;
  labels: MailLabel[];
  supportsLabels: boolean;
  inTrash: boolean;
  showAccount: boolean;
  nowMs: number;
}) {
  const [state, dispatch] = useReducer(reduce, initialState);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    const params = new URLSearchParams({ q });
    if (view !== "inbox") params.set("view", view);
    if (account) params.set("acct", account);
    (async () => {
      try {
        const response = await fetch(`/api/mail/search?${params}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok || !response.body) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          dispatch({ type: "error", message: body?.error ?? "検索できませんでした。" });
          dispatch({ type: "done" });
          return;
        }
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          let newline = buffer.indexOf("\n");
          while (newline >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (line) {
              try {
                dispatch(JSON.parse(line) as SearchEvent<MailListRow>);
              } catch {
                // 読めない行は飛ばす
              }
            }
            newline = buffer.indexOf("\n");
          }
        }
        dispatch({ type: "connection_lost" });
      } catch {
        if (!controller.signal.aborted) dispatch({ type: "connection_lost" });
      }
    })();
    return () => controller.abort();
  }, [q, view, account]);

  const { shown, folded, annotations } = useMemo(() => {
    const annotations: Record<string, MailRowAnnotation> = {};
    if (state.ranks) {
      const ranks = new Map<string, SearchRank>(Object.entries(state.ranks));
      const { shown, folded } = orderByRank(state.rows, ranks);
      for (const { item, level } of [...shown, ...folded]) {
        annotations[item.id] = {
          badge: { label: SEARCH_LEVEL_LABELS[level], strong: level >= SEARCH_LEVEL_SHOWN },
          note: ranks.get(item.id)?.reason || undefined,
        };
      }
      return { shown: shown.map((entry) => entry.item), folded: folded.map((entry) => entry.item), annotations };
    }
    for (const row of state.rows) {
      const query = state.foundBy[row.id];
      if (query) annotations[row.id] = { note: `AIの検索語「${query}」で見つかった候補` };
    }
    return { shown: state.rows, folded: [], annotations };
  }, [state.rows, state.ranks, state.foundBy]);

  const rowsProps = {
    labels,
    supportsLabels,
    inTrash,
    showAccount,
    nowMs,
    back,
    inboxView: false,
    initialNextToken: null,
    listQuery: { view, acct: account, q },
    annotations,
  };

  return (
    <div className="flex flex-col gap-2.5">
      <SearchProgress
        state={state}
        total={state.rows.length}
        onCancel={() => {
          dispatch({ type: "cancel" });
          controllerRef.current?.abort();
        }}
      />
      {state.error && (
        <p role="alert" className="rounded-[10px] border border-danger/30 bg-danger-surface px-3.5 py-2.5 text-xs leading-relaxed text-danger">
          {state.error}
        </p>
      )}
      {state.partial && (
        <p role="alert" className="rounded-[10px] border border-danger/30 bg-danger-surface px-3.5 py-2.5 text-xs leading-relaxed text-danger">
          一部のアカウントを取得できなかったため、検索結果に欠けがあります。
        </p>
      )}
      {shown.length > 0 && <MailRows {...rowsProps} messages={shown} />}
      {state.done && !state.cancelled && !state.error && state.rows.length === 0 && (
        <p className="rounded-xl border border-border bg-surface px-4 py-3 text-xs text-muted">
          {state.notice ? "キーワードに一致するメールはありませんでした。" : "近いメールは見つかりませんでした。"}
        </p>
      )}
      {state.ranks && shown.length === 0 && folded.length > 0 && (
        <p className="rounded-xl border border-border bg-surface px-4 py-3 text-xs text-muted">とても近い・近いと判断したメールはありませんでした。</p>
      )}
      {folded.length > 0 && (
        <details className="group flex flex-col gap-2.5">
          <summary className="cursor-pointer list-none rounded-[10px] border border-dashed border-border px-3.5 py-2 text-xs text-muted">
            <span className="group-open:hidden">▸</span>
            <span className="hidden group-open:inline">▾</span> 関連が薄いメール（{folded.length}通）
          </summary>
          <div className="mt-2.5">
            <MailRows {...rowsProps} messages={folded} />
          </div>
        </details>
      )}
    </div>
  );
}

function SearchProgress({ state, total, onCancel }: { state: State; total: number; onCancel: () => void }) {
  if (state.error && total === 0) return null;
  const running = !state.done;
  const doneQueries = state.queries?.filter((item) => item.status !== "run").length ?? 0;
  const allQueries = state.queries?.length ?? 0;
  // 進み具合の目安: キーワード（1）＋条件づくり（1）＋条件ごと＋並べ替え（1）
  const steps = 3 + allQueries;
  const passed = (state.keywordDone ? 1 : 0) + (state.queries ? 1 : 0) + doneQueries + (state.ranks || state.done ? 1 : 0);
  const percent = state.done ? 100 : Math.max(8, Math.round((passed / steps) * 100));

  const title = state.cancelled
    ? "検索を中断しました"
    : state.done
    ? state.ranks
      ? "AIが近い順に並べました"
      : state.notice
        ? "キーワードで検索しました"
        : "検索しました"
    : state.ranking
      ? "AIが近い順に並べ替えています…"
      : !state.keywordDone
        ? "検索しています…"
        : "AIで似ているメールを探しています…";

  const keywordCount = total - Object.keys(state.foundBy).length;
  const aiCount = Object.keys(state.foundBy).length;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("relative rounded-[10px] border border-border px-3 py-2.5 text-xs leading-relaxed", running ? "bg-topic-surface" : "bg-surface")}
    >
      {running && (
        <button
          type="button"
          aria-label="検索を中断する"
          onClick={onCancel}
          className="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-md text-topic hover:bg-rail-active"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      )}
      <p className={cn("flex items-center gap-2 font-bold", running ? "pr-8 text-topic" : "text-foreground")}>
        {running ? (
          <span aria-hidden className="size-3 shrink-0 animate-spin rounded-full border-2 border-topic border-r-transparent" />
        ) : (
          <Sparkles className="size-3.5 shrink-0 text-accent" aria-hidden="true" />
        )}
        {title}
        {state.done && total > 0 && (
          <span className="font-normal text-muted">
            ・候補 {total}通
            {state.cancelled ? "（近い順には並べていません）" : allQueries > 0 ? `・${allQueries + 1}つの語で検索` : ""}
          </span>
        )}
      </p>
      {running && (
        <div className="mt-2 h-[3px] overflow-hidden rounded bg-border">
          <div className="h-full bg-topic transition-[width] duration-500" style={{ width: `${percent}%` }} />
        </div>
      )}
      {state.queries && state.queries.length > 0 && (running || !state.ranks) && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="AIが作った検索語">
          {state.queries.map((item) => (
            <li
              key={item.query}
              className={cn(
                "max-w-full truncate rounded-md bg-rail px-1.5 py-px text-[0.65625rem]",
                item.status === "run" ? "text-muted" : item.status === "failed" ? "text-danger" : "text-foreground",
              )}
            >
              {item.status === "run" ? "… " : item.status === "failed" ? "✕ " : "✓ "}
              {item.query}
            </li>
          ))}
        </ul>
      )}
      {running && state.keywordDone && (
        <p className="mt-1.5 text-muted">
          キーワードに一致した {keywordCount}通{aiCount > 0 ? ` ＋ AIの検索語で見つかった ${aiCount}通` : ""}。調べ終わったら近い順に並べ替えます。
        </p>
      )}
      {state.notice && <p className="mt-1.5 text-muted">{state.notice}</p>}
    </div>
  );
}
