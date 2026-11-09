"use client";

import { useEffect, useState } from "react";

import { visibleChars } from "@/lib/mail/typewriter-core";

/**
 * 文字送りの進み具合（#838）。`animate` が偽、または動きを減らす設定（`prefers-reduced-motion`）のときは
 * 最初から全部を見せる。戻り値は表示する文字数。`total` が変わったら（別の結果）最初から数え直す。
 * `setState` は `requestAnimationFrame` のコールバックの中だけで呼ぶ。
 */
export function useTypewriter(total: number, animate: boolean, resetKey: unknown): number {
  const [state, setState] = useState<{ key: unknown; shown: number }>({ key: resetKey, shown: 0 });

  useEffect(() => {
    if (!animate || total === 0) return;
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const shown = reduce ? total : visibleChars(total, now - started);
      setState({ key: resetKey, shown });
      if (shown < total) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animate, total, resetKey]);

  if (!animate) return total;
  return state.key === resetKey ? Math.min(state.shown, total) : 0;
}
