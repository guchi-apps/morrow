"use client";

import { useState } from "react";

import { hasRemoteImages, mailSrcdoc } from "@/lib/mail/contract";

/**
 * メール本文（#683）。HTMLはAIDEが加工せずに返すので、**スクリプトの動かない枠**に閉じ込める。
 *
 * - `sandbox` に `allow-scripts`・`allow-same-origin` を付けない＝メール内のスクリプトは動かず、MorrowのCookie・画面に触れない
 * - 枠の中のCSPで外部の読み込みを止め、画像だけ「画像を表示」で `https:` を許す（`mailSrcdoc()`）
 * - リンクは新しいタブで開く（`allow-popups-to-escape-sandbox`）。リファラは送らない
 */
export function MailBody({ html, text }: { html: string | null; text: string | null }) {
  const [showImages, setShowImages] = useState(false);
  const [height, setHeight] = useState(480);

  if (!html) {
    return <pre className="whitespace-pre-wrap break-words px-4 py-4 font-sans text-[0.8125rem] leading-relaxed">{text || "（本文なし）"}</pre>;
  }

  const remote = hasRemoteImages(html);
  return (
    <div className="flex flex-col gap-2 px-3 py-3">
      {remote && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-background px-3 py-1.5 text-[0.6875rem] text-muted">
          <span>{showImages ? "外部の画像を表示しています" : "外部の画像を止めています"}</span>
          <button
            type="button"
            onClick={() => setShowImages((value) => !value)}
            className="rounded-[9px] border border-border bg-surface px-2.5 py-1 text-xs text-foreground hover:bg-rail-active"
          >
            {showImages ? "画像を止める" : "画像を表示"}
          </button>
        </div>
      )}
      <iframe
        key={showImages ? "images" : "blocked"}
        title="メール本文"
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        srcDoc={mailSrcdoc(html, showImages)}
        style={{ height }}
        className="w-full rounded-lg border border-border bg-white"
      />
      <button type="button" onClick={() => setHeight((value) => value + 480)} className="self-center text-[0.6875rem] text-muted underline">
        枠を縦に広げる
      </button>
    </div>
  );
}
