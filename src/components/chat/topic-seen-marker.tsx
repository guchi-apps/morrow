"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * 話題の画面を開いたことを記録する（#418）。**描いた時刻（`renderedAt`）を送る**——描いた後に取り込んだ
 * 記事を見ないまま既読にしないため。マウント時の1回だけ（`router.refresh()` では送り直さない）。
 * 失敗しても画面は止めない（次に開いたときに送る）。
 */
export function TopicSeenMarker({ renderedAt }: { renderedAt: string }) {
  const router = useRouter();
  useEffect(() => {
    void fetch("/api/topics/seen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seenAt: renderedAt }),
    })
      .then((res) => {
        // レイアウトのバッジ（未読件数。#964）を取り直す。画面の「新着」の線は初回のseenAtで固定なので消えない。
        if (res.ok) router.refresh();
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 初回の描画時刻だけを送る。
  }, []);
  return null;
}
