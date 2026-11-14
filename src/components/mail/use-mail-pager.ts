"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** 絞り込みで0件のページが続いたとき、自動で先へ進むのをやめる回数（ボタンで続ける）。 */
export const EMPTY_PAGE_LIMIT = 3;

type Page<Row> = { rows: Row[]; nextPageToken: string | null };
type Buffered<Row> = Page<Row> & { token: string };

export type MailPagerStatus = "idle" | "loading" | "error" | "stalled";

/**
 * メール一覧の続きを足していく（#887）。最初に1ページ目の次を裏で先読みしておき、
 * 下端の目印（`sentinelRef`）が近づいたら先読み済みの分を表示へ足して、さらに次を先読みする。
 * 1ページ目は呼び出し側（サーバー描画）が持つ。条件（`query`）が変わる場合は、呼び出し側が `key` で作り直す。
 */
export function useMailPager<Row>(initialNextToken: string | null, query: { view: string; acct: string | null; q: string }) {
  // 足したページごとの鍵と行。要約待ちの取り直し（`refreshPages`）で同じ鍵を取り直して差し替える
  const pagesRef = useRef<{ token: string; rows: Row[] }[]>([]);
  const [extra, setExtra] = useState<Row[]>([]);
  const [hasMore, setHasMore] = useState(initialNextToken !== null);
  const [status, setStatus] = useState<MailPagerStatus>("idle");
  const sentinelRef = useRef<HTMLDivElement>(null);
  const kickRef = useRef<() => void>(() => undefined);
  const refreshRef = useRef<(needsRefresh: (row: Row) => boolean) => Promise<void>>(async () => undefined);
  const { view, acct, q } = query;

  useEffect(() => {
    let cancelled = false;
    let cursor = initialNextToken;
    let buffer: Buffered<Row> | null = null;
    let fetching = false;
    let wanting = false;
    let streak = 0;
    let failed = false;
    const node = sentinelRef.current;
    let observer: IntersectionObserver | null = null;

    function publish() {
      if (cancelled) return;
      setStatus(failed ? "error" : streak >= EMPTY_PAGE_LIMIT ? "stalled" : fetching && wanting ? "loading" : "idle");
    }

    function urlFor(token: string) {
      const params = new URLSearchParams({ page: token });
      if (view !== "inbox") params.set("view", view);
      if (acct) params.set("acct", acct);
      if (q) params.set("q", q);
      return `/api/mail/list?${params}`;
    }

    refreshRef.current = async (needsRefresh) => {
      const targets = pagesRef.current.filter((page) => page.rows.some(needsRefresh));
      if (targets.length === 0) return;
      await Promise.all(
        targets.map(async (page) => {
          try {
            const response = await fetch(urlFor(page.token));
            if (!response.ok) return;
            const body = (await response.json()) as Page<Row>;
            page.rows = body.rows;
          } catch {
            // 取り直せなかった回は、いまの表示のまま
          }
        }),
      );
      if (!cancelled) setExtra(pagesRef.current.flatMap((page) => page.rows));
    };

    async function prefetch() {
      if (cancelled || fetching || buffer || failed || cursor === null || streak >= EMPTY_PAGE_LIMIT) return;
      fetching = true;
      const token = cursor;
      try {
        const response = await fetch(urlFor(token));
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as Page<Row>;
        buffer = { token, rows: body.rows, nextPageToken: body.nextPageToken };
      } catch {
        failed = true;
      }
      fetching = false;
      settle();
    }

    /** 先読み済みを、求められている（または空のページ）なら表示へ足す。 */
    function settle() {
      if (cancelled) return;
      const page = buffer;
      if (page && (wanting || page.rows.length === 0)) {
        buffer = null;
        cursor = page.nextPageToken;
        streak = page.rows.length === 0 ? streak + 1 : 0;
        if (page.rows.length > 0) wanting = false;
        pagesRef.current.push({ token: page.token, rows: page.rows });
        setExtra((current) => [...current, ...page.rows]);
        setHasMore(cursor !== null);
        // 足したあとも下端が見えているなら、観測を作り直して再判定する
        if (node && observer) {
          observer.unobserve(node);
          observer.observe(node);
        }
      }
      publish();
      void prefetch();
    }

    kickRef.current = () => {
      failed = false;
      streak = 0;
      wanting = true;
      settle();
      publish();
    };

    if (node && initialNextToken !== null) {
      observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          wanting = true;
          settle();
        },
        { rootMargin: "400px 0px" },
      );
      observer.observe(node);
    }
    void prefetch();

    return () => {
      cancelled = true;
      observer?.disconnect();
    };
    // 条件が変わったら呼び出し側が key で作り直す（先頭ページの取り直しでは足した続きを保つ）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retry = useCallback(() => kickRef.current(), []);
  const refreshPages = useCallback((needsRefresh: (row: Row) => boolean) => refreshRef.current(needsRefresh), []);
  return { extra, hasMore, status, sentinelRef, retry, refreshPages };
}
