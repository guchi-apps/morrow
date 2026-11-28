"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, useSyncExternalStore, type MouseEvent } from "react";

import { chatLink, EMPTY_CHAT_LINK, subscribeChatLink } from "@/lib/hermes/chat-link";
import type { SessionSummary } from "@/lib/hermes/contract";
import { lastActiveLabel, sessionLabel } from "@/lib/hermes/session-list-view";
import { cn } from "@/lib/utils";

type FetchResult = { sessions: SessionSummary[] } | { error: string };

const FALLBACK_ERROR = "会話の一覧を読み込めませんでした。";

/** 一覧を取る。取れなかった回は理由（サーバーの文言）を返す（空の一覧と混ぜない）。 */
async function fetchSessions(signal?: AbortSignal): Promise<FetchResult> {
  try {
    const response = await fetch("/api/hermes/sessions", { cache: "no-store", signal });
    const data = (await response.json().catch(() => null)) as { sessions?: SessionSummary[]; error?: unknown } | null;
    if (response.ok && Array.isArray(data?.sessions)) return { sessions: data.sessions };
    // サーバーが理由を返していれば出す（「ブリッジが古い」と「届かない」を見分けられるように。#1175）
    return { error: typeof data?.error === "string" && data.error !== "" ? `${FALLBACK_ERROR}${data.error}` : FALLBACK_ERROR };
  } catch {
    return { error: FALLBACK_ERROR };
  }
}

/**
 * 過去の会話の一覧（#1156。#1228でメニュー上部へ移した）。`GET /api/hermes/sessions`（自分のものだけ）を読む。
 * チャット画面が開いていれば画面の会話を切り替え（`chat-link.ts`）、それ以外の画面からは `/chat?session=<id>` へ移る。
 * 本文は持たない。選んだ会話の復元は画面（`ChatView`）が既存の履歴の経路で行う。
 */
export function SessionList({
  active,
  onNavigate,
}: {
  /** 一覧が見えているか。見えていない間は取りに行かない（直前の一覧は残す）。 */
  active: boolean;
  /** 会話を選んだとき（ドロワーを閉じる）。 */
  onNavigate?: () => void;
}) {
  const { currentId, busy, refreshKey, open } = useSyncExternalStore(subscribeChatLink, chatLink, () => EMPTY_CHAT_LINK);
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // 取得した時刻（描画中に `Date.now()` を呼ばない）
  const [loadedAt, setLoadedAt] = useState(0);

  const apply = useCallback((result: FetchResult) => {
    if ("error" in result) {
      setFailure(result.error);
      return;
    }
    setLoadedAt(Date.now());
    setSessions(result.sessions);
    setFailure(null);
  }, []);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void fetchSessions(controller.signal).then((result) => {
      if (!controller.signal.aborted) apply(result);
    });
    return () => controller.abort();
  }, [active, apply, refreshKey]);

  function select(event: MouseEvent<HTMLAnchorElement>, sessionId: string) {
    // 別タブで開く操作はリンクのまま
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (open) {
      event.preventDefault();
      if (busy) return;
      open(sessionId);
    }
    onNavigate?.();
  }

  return (
    <div className="flex flex-col gap-0.5">
      {sessions === null && failure === null && (
        <p className="flex items-center gap-1.5 px-2.5 py-2 text-xs text-muted">
          <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          読み込んでいます…
        </p>
      )}
      {failure !== null && (
        <p role="status" className="flex flex-wrap items-center gap-2 px-2.5 py-2 text-xs text-muted">
          <span>{failure}</span>
          <button type="button" onClick={() => void fetchSessions().then(apply)} className="shrink-0 rounded-md border border-border bg-background px-2 py-0.5 text-foreground">
            読み込み直す
          </button>
        </p>
      )}
      {sessions !== null && sessions.length === 0 && failure === null && <p className="px-2.5 py-2 text-xs text-muted">過去の会話はまだありません。</p>}
      {sessions?.map((session) => {
        const current = session.sessionId === currentId;
        return (
          <Link
            key={session.sessionId}
            href={`/chat?session=${encodeURIComponent(session.sessionId)}`}
            prefetch={false}
            aria-current={current ? "true" : undefined}
            aria-disabled={busy ? true : undefined}
            onClick={(event) => select(event, session.sessionId)}
            className={cn(
              "block shrink-0 rounded-[9px] px-2.5 py-1.5 transition-colors hover:bg-rail-active focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
              current && "bg-rail-active",
              busy && "opacity-50",
            )}
          >
            <span className="block truncate text-[0.8125rem] font-medium">{sessionLabel(session.title)}</span>
            <span className="block text-[0.6875rem] text-muted">
              {[lastActiveLabel(session.lastActiveAt, loadedAt), `${session.messageCount}件`].filter(Boolean).join(" · ")}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
