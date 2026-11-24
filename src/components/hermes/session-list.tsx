"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { SessionSummary } from "@/lib/hermes/contract";
import { lastActiveLabel, sessionLabel } from "@/lib/hermes/session-list-view";

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
 * 過去の会話の一覧（#1156）。`GET /api/hermes/sessions`（自分のものだけ）を読み、選ぶと `onSelect` へ会話のidを渡す。
 * 本文は持たない。選んだ会話の復元は画面（`ChatView`）が既存の履歴の経路で行う。
 */
export function SessionList({
  currentId,
  refreshKey,
  disabled,
  onSelect,
}: {
  currentId: string | null;
  /** 変わると取り直す（会話が終わった・新しい会話が始まった）。 */
  refreshKey: string;
  /** 実行中は切り替えない。 */
  disabled: boolean;
  onSelect: (sessionId: string) => void;
}) {
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
    const controller = new AbortController();
    void fetchSessions(controller.signal).then((result) => {
      if (!controller.signal.aborted) apply(result);
    });
    return () => controller.abort();
  }, [apply, refreshKey]);

  return (
    <div className="flex flex-col gap-1" aria-label="過去の会話">
      {sessions === null && failure === null && (
        <p className="flex items-center gap-1.5 px-2 py-2 text-xs text-muted">
          <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          読み込んでいます…
        </p>
      )}
      {failure !== null && (
        <p role="status" className="flex flex-wrap items-center gap-2 px-2 py-2 text-xs text-muted">
          <span>{failure}</span>
          <button type="button" onClick={() => void fetchSessions().then(apply)} className="shrink-0 rounded-md border border-border bg-background px-2 py-0.5 text-foreground">
            読み込み直す
          </button>
        </p>
      )}
      {sessions !== null && sessions.length === 0 && failure === null && <p className="px-2 py-2 text-xs text-muted">過去の会話はまだありません。</p>}
      {sessions?.map((session) => {
        const active = session.sessionId === currentId;
        return (
          <button
            key={session.sessionId}
            type="button"
            disabled={disabled}
            aria-current={active ? "true" : undefined}
            onClick={() => onSelect(session.sessionId)}
            className={`rounded-xl border px-3 py-2 text-left disabled:opacity-50 ${active ? "border-border bg-rail-active" : "border-transparent hover:bg-rail-active"}`}
          >
            <span className="block truncate text-sm font-semibold">{sessionLabel(session.title)}</span>
            <span className="block text-xs text-muted">
              {[lastActiveLabel(session.lastActiveAt, loadedAt), `${session.messageCount}件`].filter(Boolean).join(" · ")}
            </span>
          </button>
        );
      })}
    </div>
  );
}
