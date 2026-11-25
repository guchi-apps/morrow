"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { MenuBadge } from "./menu-badge";

/**
 * 記憶の確認待ちの件数バッジ（#1155）。ナッジの自動見直しが会話の後で作った保留は通知されないので、メニューを開いたとき・
 * 画面を移ったときに件数を取り直して補う。**取れなかった回は何も出さない**（0件と混ぜない）。Hermesが落ちていてもメニューを遅らせない。
 */
export function MemoryPendingBadge() {
  const pathname = usePathname();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/hermes/memory/pending-count", { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { count?: number | null } | null) => setCount(typeof body?.count === "number" ? body.count : null))
      .catch(() => {});
    return () => controller.abort();
  }, [pathname]);

  if (count === null) return null;
  return <MenuBadge count={count} label={`記憶の確認待ち${count}件`} />;
}
