"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { cn } from "@/lib/utils";

/**
 * ダッシュボードを左右にめくって前後の日へ移る（#606）。右→左で翌日（`nextHref`）、左→右で前日（`prevHref`）。
 *
 * - **縦のスクロールを邪魔しない。** 最初の動きで向きを決め、横が勝ったときだけめくる（縦なら何もしない）
 * - **横にスクロールできる要素（1時間ごとの帯など）の上から始めた操作は無視する**——帯を動かしたいだけで日が変わる
 * - **画面の左右の端から始めた操作も無視する。** iOSの殻（WKWebView）は端からのスワイプを戻る・進むに使う
 *   （`allowsBackForwardNavigationGestures`）。移るときも `router.replace` で履歴を積まず、戻る操作と食い合わせない
 * - 指に合わせて中身が付いてきて、一定の距離（`THRESHOLD`）を超えて離すと移る。端の日（行き先なし）は少しだけ動いて戻る
 *
 * ボタン（‹ ›）は見出しの `Link` が受け持つので、ここはタッチ操作だけ。JSが動く前でもボタンでは移れる。
 */

/** めくったとみなす距離（画面幅に対する割合と、最低限の px）。 */
const THRESHOLD_RATIO = 0.2;
const THRESHOLD_MIN_PX = 60;
/** 端から始めた操作を無視する幅（iOSの戻る・進むの操作）。 */
const EDGE_PX = 24;
/** 向きを決めるまでの動き。 */
const LOCK_PX = 10;

type Gesture = { x: number; y: number; dir: "h" | "v" | null };

function startsOnHorizontalScroller(target: EventTarget | null, root: HTMLElement): boolean {
  for (let node = target instanceof Element ? target : null; node && node !== root; node = node.parentElement) {
    if (node instanceof HTMLElement && node.scrollWidth > node.clientWidth) {
      const overflow = getComputedStyle(node).overflowX;
      if (overflow === "auto" || overflow === "scroll") return true;
    }
  }
  return false;
}

export function DaySwipe({
  prevHref,
  nextHref,
  prevLabel,
  nextLabel,
  children,
}: {
  prevHref: string | null;
  nextHref: string | null;
  /** 端にのぞかせる行き先の日（「きのう」「10/24」）。 */
  prevLabel: string | null;
  nextLabel: string | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<Gesture | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const reset = () => {
    gesture.current = null;
    setDragging(false);
    setDx(0);
  };

  const onTouchStart = (event: React.TouchEvent) => {
    const root = rootRef.current;
    if (!root || event.touches.length !== 1) return reset();
    const touch = event.touches[0];
    if (touch.clientX < EDGE_PX || touch.clientX > window.innerWidth - EDGE_PX) return;
    if (startsOnHorizontalScroller(event.target, root)) return;
    gesture.current = { x: touch.clientX, y: touch.clientY, dir: null };
  };

  const onTouchMove = (event: React.TouchEvent) => {
    const current = gesture.current;
    if (!current || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const moveX = touch.clientX - current.x;
    const moveY = touch.clientY - current.y;
    if (current.dir === null) {
      if (Math.abs(moveX) < LOCK_PX && Math.abs(moveY) < LOCK_PX) return;
      current.dir = Math.abs(moveX) > Math.abs(moveY) * 1.5 ? "h" : "v";
      if (current.dir === "h") setDragging(true);
    }
    if (current.dir !== "h") return;
    // 行き先の無い向き（範囲の端）は、少しだけ動かして「これ以上めくれない」を伝える。
    const target = moveX < 0 ? nextHref : prevHref;
    setDx(target ? moveX : moveX * 0.15);
  };

  const onTouchEnd = () => {
    const current = gesture.current;
    if (!current || current.dir !== "h") return reset();
    const width = rootRef.current?.clientWidth ?? window.innerWidth;
    const threshold = Math.max(THRESHOLD_MIN_PX, width * THRESHOLD_RATIO);
    const target = dx < 0 ? nextHref : prevHref;
    reset();
    if (target && Math.abs(dx) >= threshold) {
      startTransition(() => router.replace(target, { scroll: false }));
    }
  };

  const progress = Math.min(1, Math.abs(dx) / THRESHOLD_MIN_PX / 1.5);
  const peek = dx < 0 ? nextLabel : prevLabel;
  const peekReady = dx < 0 ? nextHref : prevHref;

  return (
    <div
      ref={rootRef}
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={reset}
      aria-busy={pending}
    >
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col",
          !dragging && "transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none",
          pending && "opacity-60",
        )}
        style={dx !== 0 ? { transform: `translateX(${dx}px)` } : undefined}
      >
        {children}
      </div>
      {dragging && peek && peekReady && dx !== 0 && (
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute top-1/2 -translate-y-1/2 rounded-full bg-accent-surface px-3 py-1.5 text-xs font-bold text-accent",
            dx < 0 ? "right-3" : "left-3",
          )}
          style={{ opacity: progress }}
        >
          {dx < 0 ? `${peek} ›` : `‹ ${peek}`}
        </div>
      )}
    </div>
  );
}
