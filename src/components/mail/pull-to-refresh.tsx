"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { describeMailCheck, type CheckResult } from "./mail-check-button";
import { isPullGesture, PULL_THRESHOLD, pullDistance, shouldRefresh } from "./pull-to-refresh-core";

/**
 * メール一覧のスクロール領域を包み、先頭で下へ引いて離すと「いま確認」と同じ処理を走らせる（#1015）。
 * 新着確認（`POST /api/mail/check`。一覧キャッシュも捨てる）→ `router.refresh()`。タッチ操作だけ。
 */
export function PullToRefresh({ className, children }: { className?: string; children: ReactNode }) {
  const router = useRouter();
  const start = useRef<{ x: number; y: number } | null>(null);
  const pulling = useRef(false);
  const [distance, setDistance] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function refresh() {
    setRunning(true);
    setMessage(null);
    try {
      const response = await fetch("/api/mail/check", { method: "POST", cache: "no-store" });
      const data = (await response.json().catch(() => null)) as { result?: CheckResult } | null;
      setMessage(data?.result ? describeMailCheck(data.result) : { text: "更新に失敗しました。", error: true });
      router.refresh();
    } catch {
      setMessage({ text: "更新に失敗しました（通信できませんでした）。", error: true });
    } finally {
      setRunning(false);
    }
  }

  function onTouchStart(event: React.TouchEvent<HTMLDivElement>) {
    const touch = event.touches[0];
    start.current = running || !touch ? null : { x: touch.clientX, y: touch.clientY };
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

  const height = running ? PULL_THRESHOLD : distance;
  return (
    <div
      className={cn(className, "overscroll-y-contain")}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      <div
        aria-hidden={height === 0}
        className="flex items-center justify-center gap-2 overflow-hidden text-xs text-muted"
        style={{ height, transition: dragging ? "none" : "height 200ms ease" }}
      >
        {height > 0 && (
          <>
            <RefreshCw
              className={cn("size-4", running && "animate-spin motion-reduce:animate-none")}
              style={running ? undefined : { transform: `rotate(${distance * 4}deg)` }}
              aria-hidden="true"
            />
            <span>{running ? "更新しています…" : shouldRefresh(distance) ? "離すと更新します" : "引っ張って更新"}</span>
          </>
        )}
      </div>
      {message && !running && (
        <p
          role={message.error ? "alert" : "status"}
          className={cn(
            "mx-3.5 mt-2 rounded-lg px-3 py-2 text-xs leading-relaxed md:mx-7",
            message.error ? "border border-danger/30 bg-danger-surface text-danger" : "bg-surface text-muted",
          )}
        >
          {message.text}
        </p>
      )}
      {children}
    </div>
  );
}
