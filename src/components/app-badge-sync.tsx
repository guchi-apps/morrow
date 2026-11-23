"use client";

import { useEffect } from "react";

import { setAppBadge } from "@/lib/app-badge";

const INTERVAL_MS = 60_000;

/**
 * アプリアイコンのバッジを未読メール件数へ合わせる（#1144）。開いたとき・前面に戻ったとき・開いている間1分ごと。
 * オフのときは一度だけバッジを消す。件数が取れなかった回（null）は前の表示のままにする。
 */
export function AppBadgeSync({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled) {
      void setAppBadge(0);
      return;
    }

    let stopped = false;
    const sync = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/mail/unread-count", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as { enabled?: boolean; count?: number | null };
        if (stopped) return;
        if (body.enabled === false) void setAppBadge(0);
        else if (typeof body.count === "number") void setAppBadge(body.count);
      } catch {
        // 通信できない回は前の表示のまま
      }
    };

    void sync();
    const timer = window.setInterval(sync, INTERVAL_MS);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("online", sync);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("online", sync);
    };
  }, [enabled]);

  return null;
}
