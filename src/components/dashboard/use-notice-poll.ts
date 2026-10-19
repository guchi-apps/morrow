"use client";

import { useEffect, useRef } from "react";

/**
 * 「いまの一言」（秘書が選んだお知らせ）の1件。`/api/notices/current` の `notice` と同じ形。
 */
export type NoticeBubble = {
  id: string;
  text: string;
  urgent: boolean;
  /** 選ばれた時刻（ISO）。「いつ時点か」を出す。 */
  shownAt: string;
  /**
   * 押したときに開く先（#137）。サーバー側（`resolveNotice()`）が `safeNoticeUrl()` を通した値だけを載せる。
   */
  url: string | null;
};

/** 問い合わせの間隔。サーバー側（`resolveNotice()`）が「10分に1回まで」「未読が0件なら叩かない」を守る。 */
const POLL_INTERVAL_MS = 3 * 60 * 1000;

/** 触られないまま問い合わせ続ける上限。開きっぱなしのタブを1日中叩かせないための錠。 */
const IDLE_LIMIT_MS = 60 * 60 * 1000;

/**
 * `/api/notices/current` を定期的に叩く（#93・#574）。
 *
 * この口は、お知らせの選定（`shownAt` を書く）と、ニュースの仕入れ（応答後の `refreshTopicsIfStale()`。
 * #144）の起点を兼ねる。**アプリを開いたとき（ダッシュボードを見ているとき）に動くのはここだけ**なので、
 * 画面から外さないこと。`/api/*` は素通しの判定より前に必ず `auth.getUser()` を通るため、
 * 取得口を増やさず間隔も縮めない。
 *
 * 見えている間だけ動かし、1時間触られなければ休む。タブへ戻った直後は次の周期を待たずに取り直す。
 */
export function useNoticePoll(onNotice: (notice: NoticeBubble | null) => void): void {
  const onNoticeRef = useRef(onNotice);
  // 描画のたびに読むと値が揺れる（`react-hooks/purity`）。効果の中で入れる。
  const lastActivityRef = useRef(0);

  useEffect(() => {
    onNoticeRef.current = onNotice;
  }, [onNotice]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    lastActivityRef.current = Date.now();

    const schedule = (delay: number) => {
      if (cancelled) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void poll(), delay);
    };

    const poll = async () => {
      if (cancelled) return;

      const visible = document.visibilityState === "visible";
      const idle = Date.now() - lastActivityRef.current > IDLE_LIMIT_MS;

      if (visible && !idle) {
        try {
          const response = await fetch("/api/notices/current", { cache: "no-store" });
          if (response.ok) {
            const data = (await response.json()) as { notice?: NoticeBubble | null };
            if (!cancelled) onNoticeRef.current(data.notice ?? null);
          }
        } catch {
          // 取れなかった回は黙って見送る。状況を知らせる場所が小言で埋まると読まれなくなる（#93）。
        }
      }

      schedule(POLL_INTERVAL_MS);
    };

    const markActive = () => {
      lastActivityRef.current = Date.now();
    };

    const onVisibility = () => {
      markActive();
      if (document.visibilityState === "visible") schedule(0);
    };

    window.addEventListener("pointerdown", markActive);
    window.addEventListener("keydown", markActive);
    document.addEventListener("visibilitychange", onVisibility);

    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("pointerdown", markActive);
      window.removeEventListener("keydown", markActive);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
}
