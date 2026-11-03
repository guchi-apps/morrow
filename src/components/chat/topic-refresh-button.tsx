"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type State = { kind: "idle" } | { kind: "running" } | { kind: "done"; message: string; error: boolean };

/**
 * 「最近の記事を取得する」ボタン（#660）。話題を取りに行く手段は、これと定時の時刻だけ。
 * 1回30秒〜数分かかるので、待つあいだは押せなくして状況を出す。終わったら一覧を読み直す。
 */
export function TopicRefreshButton() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "idle" });
  const running = state.kind === "running";

  async function refresh() {
    if (running) return;
    setState({ kind: "running" });
    try {
      const response = await fetch("/api/topics/refresh", { method: "POST" });
      const body = (await response.json().catch(() => null)) as { result?: string } | null;
      switch (body?.result) {
        case "fetched":
          setState({ kind: "done", message: "取得しました。", error: false });
          router.refresh();
          return;
        case "busy":
          setState({ kind: "done", message: "すでに取得中です。しばらくしてから読み込み直してください。", error: false });
          return;
        case "disabled":
          setState({ kind: "done", message: "仕入れる種類が1つも選ばれていません。下の「仕入れる種類」で選んでください。", error: true });
          return;
        default:
          setState({ kind: "done", message: "取得できませんでした。時間をおいてもう一度試してください。", error: true });
      }
    } catch {
      setState({ kind: "done", message: "取得できませんでした。通信を確かめてください。", error: true });
    }
  }

  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
      <button
        type="button"
        onClick={refresh}
        disabled={running}
        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3.5 py-2.5 text-[0.8125rem] font-bold text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60 md:py-2"
      >
        {running ? "取得しています…（30秒ほど）" : "↻ 最近の記事を取得する"}
      </button>
      <p
        role="status"
        className={`text-[0.6875rem] leading-relaxed ${state.kind === "done" && state.error ? "text-danger" : "text-muted"}`}
      >
        {state.kind === "done" ? state.message : "ウェブ検索で30秒〜数分かかります。"}
      </p>
    </div>
  );
}
