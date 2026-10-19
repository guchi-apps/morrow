"use client";

import { createContext, useCallback, useContext, useState } from "react";

import { useNudges } from "@/components/chat/use-nudge";
import { OpenLink, noticeStamp } from "@/components/voice/speech-bubble";
import type { BubblePayload, NoticeBubble } from "@/components/voice/use-notice";
import { cn } from "@/lib/utils";

/**
 * ダッシュボードの「いまの一言」（#573）。**お知らせの選定・話題の仕入れの起点も兼ねる。**
 *
 * `/api/notices/current` は、お知らせの選定（#93。`shownAt` を書く）・ニュースの仕入れ（#144。応答後の
 * `refreshTopicsIfStale()`）・声かけ（#278）の起点で、これまで叩いていたのは相談の画面だけだった。
 * トップを相談から外すと、トップを開くだけの日はどれも走らなくなる（#573の計画レビュー）。
 * そこで「書く」画面と同じ問い合わせ（`useNudges()`。3分ごと・見えている間だけ・1時間触られなければ休む）
 * をここでも持つ。**選ばれたお知らせはここに出す**ので、出さずに消費する形にはならない（#114）。
 *
 * **問い合わせは `NoticeLiveProvider` の1本だけ。** ダッシュボードはスマホ用とPC用の並びを両方描く
 * （CSSで片方を隠す）ので、`LiveNoticeLine` に持たせると同じ口を2本で叩く。
 *
 * 声かけは受け取っても並べない（相談の記録には積まれており、`/chat` で読める）。
 * 最初の描画はサーバーが引いた値で、問い合わせの応答が来たらそちらに替える。
 */

const NoticeContext = createContext<NoticeBubble | null>(null);

export function NoticeLiveProvider({
  initial,
  children,
}: {
  initial: NoticeBubble | null;
  children: React.ReactNode;
}) {
  const [notice, setNotice] = useState<NoticeBubble | null>(initial);

  const ignoreNudges = useCallback(() => {}, []);
  const onPayload = useCallback((payload: BubblePayload) => setNotice(payload.notice), []);
  useNudges(ignoreNudges, false, onPayload);

  return <NoticeContext.Provider value={notice}>{children}</NoticeContext.Provider>;
}

export function LiveNoticeLine() {
  const notice = useContext(NoticeContext);

  if (!notice) {
    return (
      <p className="rounded-[10px] border border-dashed border-border bg-background px-3 py-2.5 text-[0.8125rem] leading-relaxed text-muted">
        いま出している一言はありません。
      </p>
    );
  }

  const stamp = noticeStamp(notice.shownAt);

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-[10px] px-3 py-2.5 text-sm leading-relaxed",
        notice.urgent ? "border border-accent/40 bg-accent-surface font-bold text-accent" : "bg-accent-surface",
      )}
    >
      <div className="min-w-0 flex-1">
        {notice.urgent && (
          <span className="mr-1.5 rounded-full bg-accent px-2 py-0.5 text-[0.625rem] font-bold tracking-wider text-accent-foreground">
            急ぎ
          </span>
        )}
        {notice.text}
        <span className="mt-0.5 block text-[0.6875rem] font-normal text-muted">
          いま秘書が出している一言{stamp && `・${stamp}`}
        </span>
      </div>
      {notice.url && <OpenLink url={notice.url} />}
    </div>
  );
}
