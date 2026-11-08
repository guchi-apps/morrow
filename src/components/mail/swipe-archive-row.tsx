"use client";

import { Archive } from "lucide-react";
import { useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { followOffset, isArchiveRelease, lockDirection, startsAtScreenEdge } from "./swipe-archive";

type Gesture = { x: number; y: number; dir: "h" | "v" | null };

/**
 * 一覧の行を右→左へスワイプしてアーカイブする（#715）。
 *
 * - 縦のスクロールを邪魔しない（`touch-action: pan-y`。最初の動きで向きを決め、横が勝ったときだけ追従する）
 * - 画面の左右24pxから始めた操作は無視する（iOSの殻の戻る・進むのスワイプと食い合わせない）
 * - しきい値を超えて離すと行が左へ抜け、`onArchive` が成功したら行は一覧から消える（呼び出し側が取り直す）。失敗したら戻す
 */
export function SwipeArchiveRow({
  enabled,
  onArchive,
  className,
  children,
}: {
  enabled: boolean;
  onArchive: () => Promise<boolean>;
  /** 前面（行の中身）の見た目。背景は不透明にする。 */
  className?: string;
  children: React.ReactNode;
}) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const gesture = useRef<Gesture | null>(null);
  const rootRef = useRef<HTMLLIElement>(null);

  const width = () => rootRef.current?.clientWidth ?? 0;
  const [ready, setReady] = useState(false);

  const cancel = () => {
    gesture.current = null;
    setDragging(false);
    setOffset(0);
    setReady(false);
  };

  const onTouchStart = (event: React.TouchEvent) => {
    if (!enabled || leaving || event.touches.length !== 1) return;
    const touch = event.touches[0];
    if (startsAtScreenEdge(touch.clientX, window.innerWidth)) return;
    gesture.current = { x: touch.clientX, y: touch.clientY, dir: null };
  };

  const onTouchMove = (event: React.TouchEvent) => {
    const g = gesture.current;
    if (!g) return;
    const touch = event.touches[0];
    const dx = touch.clientX - g.x;
    const dy = touch.clientY - g.y;
    if (!g.dir) {
      g.dir = lockDirection(dx, dy);
      if (g.dir === "h") setDragging(true);
    }
    if (g.dir === "h") {
      const next = followOffset(dx);
      setOffset(next);
      setReady(isArchiveRelease(next, width()));
    }
    else if (g.dir === "v") gesture.current = null;
  };

  const onTouchEnd = async () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g || g.dir !== "h") return cancel();
    setDragging(false);
    if (!ready) return cancel();
    setLeaving(true);
    setOffset(-width());
    const ok = await onArchive();
    if (!ok) {
      setLeaving(false);
      setReady(false);
      setOffset(0);
    }
  };

  return (
    <li ref={rootRef} className="relative overflow-hidden border-t border-border first:border-t-0">
      <div
        aria-hidden
        className={cn(
          "absolute inset-0 flex items-center justify-end gap-1.5 pr-5 text-sm font-bold text-white transition-colors",
          ready || leaving ? "bg-emerald-600" : "bg-emerald-800",
        )}
      >
        <Archive className="size-4" />
        {ready || leaving ? "離すとアーカイブ" : "アーカイブ"}
      </div>
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={cancel}
        style={{ transform: offset ? `translateX(${offset}px)` : undefined }}
        className={cn(
          "relative touch-pan-y",
          !dragging && "transition-transform duration-200",
          className,
        )}
      >
        {children}
      </div>
    </li>
  );
}

