"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

type Direction = "forward" | "back" | "none";

/** 本文の画面（`/mail/<id>`）か。 */
function isDetailPath(path: string): boolean {
  return path.startsWith("/mail/");
}

/** 一覧→本文は右から（forward）、本文→一覧は左から（back）。それ以外（本文→別の本文など）は動かさない。 */
function directionOf(from: string, to: string): Direction {
  const a = isDetailPath(from);
  const b = isDetailPath(to);
  if (!a && b) return "forward";
  if (a && !b) return "back";
  return "none";
}

/**
 * ブラウザの戻る・進む（iOSの殻の端からのスワイプを含む）で移った回か。殻やブラウザが
 * 自分の動きを付けるので、こちらの滑り込みと二重にしない。`popstate` はパスが変わる前に届く。
 */
let poppedNavigation = false;

/**
 * メールの一覧⇔本文の切り替えの動き（#699）。パスが変わったときだけ、向きに合わせて
 * 中身を滑り込ませる（同じパスの中の絞り込み・検索・ページ送りでは動かさない）。
 * 読み込み中は `loading.tsx` のスケルトンが先にこの中へ入るので、押した直後に動き始める。
 */
export function MailTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [shown, setShown] = useState<{ path: string; direction: Direction }>({ path: pathname, direction: "none" });

  if (shown.path !== pathname) {
    setShown({ path: pathname, direction: poppedNavigation ? "none" : directionOf(shown.path, pathname) });
  }

  useEffect(() => {
    const onPop = () => {
      poppedNavigation = true;
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    poppedNavigation = false;
  }, [pathname]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        key={shown.path}
        data-mail-pane=""
        className={cn(
          "flex min-h-0 flex-1 flex-col",
          shown.direction === "forward" && "mail-pane-enter-forward",
          shown.direction === "back" && "mail-pane-enter-back",
        )}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * 押した側の画面を反対へ少し退かせる。修飾キー付きのクリック（新しいタブで開く）では何もしない。
 * 移動が始まらなかった回に画面が退いたまま残らないよう、少し経ったら戻す。
 */
export function leaveMailPane(event: React.MouseEvent<HTMLElement>, direction: "forward" | "back"): boolean {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return false;
  }
  const pane = event.currentTarget.closest<HTMLElement>("[data-mail-pane]");
  if (!pane) return true;
  const className = `mail-pane-leave-${direction}`;
  pane.classList.remove("mail-pane-enter-forward", "mail-pane-enter-back");
  pane.classList.add(className);
  window.setTimeout(() => pane.classList.remove(className), 1500);
  return true;
}
