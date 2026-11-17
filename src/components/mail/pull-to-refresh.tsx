"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useContext, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { isPullGesture, PULL_THRESHOLD, pullDistance, shouldRefresh } from "./pull-to-refresh-core";

const EDGE_PX = 24;

type PullState = { distance: number; dragging: boolean; running: boolean; failed: boolean };
const PullContext = createContext<PullState>({ distance: 0, dragging: false, running: false, failed: false });

/**
 * 引っ張り更新の表示（#1049）。上に固定した帯（表示切替・検索）の下に置く。帯は動かさず、このぶんだけ一覧が下がる。
 * `PullToRefresh` の内側で描く。何も出さないときは何も描かない（余白を作らない）。
 */
export function PullIndicator() {
  const { distance, dragging, running, failed } = useContext(PullContext);
  const height = running ? PULL_THRESHOLD : distance;
  if (height === 0 && !failed) return null;
  return (
    <>
      {height > 0 && (
        <div
          className="flex items-center justify-center gap-2 overflow-hidden text-xs text-muted"
          style={{ height, transition: dragging ? "none" : "height 200ms ease" }}
        >
          <RefreshCw
            className={cn("size-4", running && "animate-spin motion-reduce:animate-none")}
            style={running ? undefined : { transform: `rotate(${distance * 4}deg)` }}
            aria-hidden="true"
          />
          <span>{running ? "更新しています…" : shouldRefresh(distance) ? "離すと更新します" : "引っ張って更新"}</span>
        </div>
      )}
      {failed && !running && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-danger-surface px-3 py-2 text-xs text-danger">
          更新に失敗しました（通信できませんでした）。
        </p>
      )}
    </>
  );
}

/**
 * メール一覧のスクロール領域を包み、先頭で下へ引いて離すと一覧を取り直す（#1015）。表示は `PullIndicator` が固定の帯の下に出す（#1049）。
 * 一覧キャッシュを捨てる（`POST /api/mail/refresh`）→ `router.refresh()`。新着の判定（`/api/mail/check`）は裏で走らせ、終わったらもう一度取り直す。タッチ操作だけ。
 */
export function PullToRefresh({ className, children }: { className?: string; children: ReactNode }) {
  const router = useRouter();
  const start = useRef<{ x: number; y: number } | null>(null);
  const pulling = useRef(false);
  const [distance, setDistance] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState(false);

  async function refresh() {
    setRunning(true);
    setFailed(false);
    try {
      // 一覧のキャッシュを捨てて取り直す。新着の判定は時間がかかる（Codex）ので待たず、終わったら一覧を取り直す
      await fetch("/api/mail/refresh", { method: "POST", cache: "no-store" });
      router.refresh();
      void fetch("/api/mail/check", { method: "POST", cache: "no-store" })
        .then(() => router.refresh())
        .catch(() => undefined);
      await new Promise((resolve) => window.setTimeout(resolve, 600));
    } catch {
      setFailed(true);
    } finally {
      setRunning(false);
    }
  }

  function onTouchStart(event: React.TouchEvent<HTMLDivElement>) {
    const touch = event.touches[0];
    // 画面の左右端（戻る・進むのスワイプ）から始めた操作は拾わない
    const edge = touch ? touch.clientX < EDGE_PX || touch.clientX > window.innerWidth - EDGE_PX : false;
    start.current = running || !touch || edge ? null : { x: touch.clientX, y: touch.clientY };
    pulling.current = false;
  }

  function onTouchMove(event: React.TouchEvent<HTMLDivElement>) {
    const origin = start.current;
    const touch = event.touches[0];
    if (!origin || !touch) return;
    const dx = touch.clientX - origin.x;
    const dy = touch.clientY - origin.y;
    if (!pulling.current) {
      if (dy < 0 || event.currentTarget.scrollTop > 0) {
        start.current = null;
        return;
      }
      if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return;
      if (!isPullGesture(event.currentTarget.scrollTop, dx, dy)) {
        start.current = null;
        return;
      }
      pulling.current = true;
      setDragging(true);
    }
    setDistance(pullDistance(dy));
  }

  function onTouchEnd() {
    const go = pulling.current && shouldRefresh(distance);
    start.current = null;
    pulling.current = false;
    setDistance(0);
    setDragging(false);
    if (go) void refresh();
  }

  return (
    <PullContext.Provider value={{ distance, dragging, running, failed }}>
      <div
        className={cn(className, "overscroll-y-contain")}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        {children}
      </div>
    </PullContext.Provider>
  );
}
