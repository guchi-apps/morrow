"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createPortal } from "react-dom";

import { HEADER_ICON_BUTTON, useHeaderSlot } from "@/components/chat/header-actions";
import { cn } from "@/lib/utils";

type State = { kind: "idle" } | { kind: "running" } | { kind: "done"; message: string; error: boolean };

/**
 * 「最近の記事を取得する」ボタン（#660）。ニュースを取りに行く手段は、これと定時の時刻だけ。
 * 1回30秒〜数分かかるので、待つあいだは押せなくして状況を出す。終わったら一覧を読み直す。
 */
export function TopicRefreshButton() {
  const router = useRouter();
  const slot = useHeaderSlot();
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
          setState({ kind: "done", message: "仕入れる種類が1つも選ばれていません。ヘッダーの「取得する内容」で選んでください。", error: true });
          return;
        default:
          setState({ kind: "done", message: "取得できませんでした。時間をおいてもう一度試してください。", error: true });
      }
    } catch {
      setState({ kind: "done", message: "取得できませんでした。通信を確かめてください。", error: true });
    }
  }

  const label = running ? "取得しています…（30秒ほど）" : "最近の記事を取得する";
  const button = (
    <button
      type="button"
      onClick={refresh}
      disabled={running}
      aria-label={label}
      title={label}
      className={cn(HEADER_ICON_BUTTON, "border-accent bg-accent text-accent-foreground hover:bg-accent hover:opacity-90 disabled:opacity-60")}
    >
      <RefreshCw className={cn("size-4", running && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
    </button>
  );

  return (
    <>
      {slot ? createPortal(button, slot) : button}
      {(running || state.kind === "done") && (
        <p role="status" className={`text-[0.6875rem] leading-relaxed ${state.kind === "done" && state.error ? "text-danger" : "text-muted"}`}>
          {state.kind === "done" ? state.message : "取得しています…（ウェブ検索で30秒〜数分かかります）"}
        </p>
      )}
    </>
  );
}
