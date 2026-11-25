"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { flushPendingArchives } from "./archive-sender";

/** 結果を受け取れていないアーカイブを、開き直した・戻った・通信が戻ったときに確かめ直す（#1192）。画面は出さない。 */
export function PendingArchiveSync() {
  const router = useRouter();
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "visible") flushPendingArchives(() => router.refresh());
    };
    flush();
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("online", flush);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("online", flush);
    };
  }, [router]);
  return null;
}
