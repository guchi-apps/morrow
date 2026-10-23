"use client";

import { useEffect, useRef } from "react";

/**
 * 1時間ごとの帯の横スクロール枠（#609）。開いたとき、`data-now` の列（「今」）の少し手前までスクロールして、
 * 過ぎた時間は左へ送る。日付をめくった（`resetKey` が変わった）ときも同じ位置から始める。
 */
export function ScrollToNow({ className, resetKey, children }: { className?: string; resetKey: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = ref.current;
    const now = box?.querySelector<HTMLElement>("[data-now]");
    if (!box) return;
    box.scrollLeft = now ? Math.max(0, now.offsetLeft - 46) : 0;
  }, [resetKey]);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
