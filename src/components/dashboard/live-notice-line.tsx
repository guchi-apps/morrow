"use client";

import { createContext, useCallback, useContext, useState } from "react";

import { OpenLink, noticeStamp } from "@/components/dashboard/open-link";
import { useNoticePoll, type NoticeBubble } from "@/components/dashboard/use-notice-poll";
import { cn } from "@/lib/utils";

/**
 * ダッシュボードの「いまの一言」（#573）。**お知らせの選定・話題の仕入れの起点も兼ねる。**
 *
 * `/api/notices/current` は、お知らせの選定（#93。`shownAt` を書く）とニュースの仕入れ（#144。応答後の
 * `refreshTopicsIfStale()`）の起点。チャットを廃止した（#574）後、アプリを開いたときにこれを叩くのは
 * ここだけ。選ばれたお知らせはここに出すので、出さずに消費する形にはならない（#114）。
 *
 * **問い合わせは `NoticeLiveProvider` の1本だけ。** ダッシュボードはスマホ用とPC用の並びを両方描く
 * （CSSで片方を隠す）ので、`LiveNoticeLine` に持たせると同じ口を2本で叩く。
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

  const onNotice = useCallback((next: NoticeBubble | null) => setNotice(next), []);
  useNoticePoll(onNotice);

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
