"use client";

import { useEffect, useMemo, useState } from "react";

import { attachmentUrl, embeddedImages, externalImageUrls, replaceCids } from "@/lib/mail/body-images";
import { hasRemoteImages, mailSrcdoc, type MailAttachment } from "@/lib/mail/contract";

/**
 * メール本文（#683）。HTMLはAIDEが加工せずに返すので、**スクリプトの動かない枠**に閉じ込める。
 *
 * - `sandbox` に `allow-scripts`・`allow-same-origin` を付けない＝メール内のスクリプトは動かず、MorrowのCookie・画面に触れない
 * - 枠の中のCSPで外部の読み込みを止め、画像だけ「画像を表示」で `https:` を許す（`mailSrcdoc()`）
 * - 本文に埋め込まれた画像（`cid:`）も「画像を表示」を押したときだけ、Morrowの中継から取って `data:` に差し替える（#1101）
 * - 表示中は本文の下に「本文の画像」を並べ、埋め込み画像は保存、外部画像は元の画像を開く（#1101）
 * - リンクは新しいタブで開く（`allow-popups-to-escape-sandbox`）。リファラは送らない
 */
export function MailBody({
  html,
  text,
  messageId,
  attachments = [],
}: {
  html: string | null;
  text: string | null;
  messageId?: string;
  attachments?: MailAttachment[];
}) {
  const [showImages, setShowImages] = useState(false);
  const [height, setHeight] = useState(480);
  const embedded = useMemo(() => (html && messageId ? embeddedImages(html, attachments) : []), [html, messageId, attachments]);
  const external = useMemo(() => (html ? externalImageUrls(html) : []), [html]);
  const dataUrls = useEmbeddedImages(messageId, embedded, showImages);

  if (!html) {
    return <pre className="whitespace-pre-wrap break-words px-4 py-4 font-sans text-[0.8125rem] leading-relaxed">{text || "（本文なし）"}</pre>;
  }

  const remote = hasRemoteImages(html);
  const counts = [remote && external.length > 0 ? `外部 ${external.length}枚` : remote ? "外部" : null, embedded.length > 0 ? `埋め込み ${embedded.length}枚` : null].filter(Boolean).join("・");
  const body = showImages ? replaceCids(html, dataUrls.urls) : html;
  return (
    <div className="flex flex-col gap-2 px-3 py-3">
      {(remote || embedded.length > 0) && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-background px-3 py-1.5 text-[0.6875rem] text-muted">
          <span>
            {showImages ? "画像を表示しています" : "画像を止めています"}
            {counts && `（${counts}）`}
            {!showImages && remote && <span className="hidden sm:inline">。外部の画像を表示すると、差出人に開封が伝わることがあります</span>}
          </span>
          <button
            type="button"
            onClick={() => setShowImages((value) => !value)}
            className="shrink-0 rounded-[9px] border border-border bg-surface px-2.5 py-1 text-xs text-foreground hover:bg-rail-active"
          >
            {showImages ? "画像を止める" : "画像を表示"}
          </button>
        </div>
      )}
      <iframe
        key={showImages ? `images-${dataUrls.urls.size}` : "blocked"}
        title="メール本文"
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        srcDoc={mailSrcdoc(body, showImages)}
        style={{ height }}
        className="w-full rounded-lg border border-border bg-white"
      />
      <button type="button" onClick={() => setHeight((value) => value + 480)} className="self-center text-[0.6875rem] text-muted underline">
        枠を縦に広げる
      </button>
      {showImages && messageId && (embedded.length > 0 || external.length > 0) && (
        <BodyImages messageId={messageId} embedded={embedded} external={external} dataUrls={dataUrls} />
      )}
    </div>
  );
}

type EmbeddedState = { urls: Map<string, string>; failed: number };

/** 埋め込み画像を中継から取り、`contentId`（小文字）→ `data:` の対応を作る。表示を許したときだけ取る。 */
function useEmbeddedImages(messageId: string | undefined, embedded: MailAttachment[], enabled: boolean): EmbeddedState {
  const [state, setState] = useState<EmbeddedState>({ urls: new Map(), failed: 0 });
  useEffect(() => {
    if (!enabled || !messageId || embedded.length === 0) return;
    let cancelled = false;
    void (async () => {
      const urls = new Map<string, string>();
      let failed = 0;
      for (const image of embedded) {
        try {
          const response = await fetch(attachmentUrl(messageId, image.attachmentId!, "view"));
          if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) throw new Error(String(response.status));
          urls.set(image.contentId!.toLowerCase(), await blobToDataUrl(await response.blob()));
        } catch {
          failed++;
        }
        if (cancelled) return;
      }
      setState({ urls, failed });
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, messageId, embedded]);
  return state;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** 本文の画像の一覧（#1101）。埋め込み画像は保存、外部画像は元の画像を開く（Morrowのサーバーは外部へ取りに行かない）。 */
function BodyImages({ messageId, embedded, external, dataUrls }: { messageId: string; embedded: MailAttachment[]; external: string[]; dataUrls: EmbeddedState }) {
  const thumb = "flex w-28 flex-col overflow-hidden rounded-lg border border-border bg-surface text-[0.625rem]";
  return (
    <section className="flex flex-col gap-1.5 border-t border-border pt-2.5" aria-label="本文の画像">
      <h3 className="px-1 text-xs font-semibold text-muted">本文の画像（{embedded.length + external.length}）</h3>
      <div className="flex flex-wrap gap-2">
        {embedded.map((image) => {
          const src = dataUrls.urls.get(image.contentId!.toLowerCase());
          return (
            <div key={`e-${image.attachmentId}`} className={thumb}>
              {src ? (
                // eslint-disable-next-line @next/next/no-img-element -- data: の画像。next/image は使えない
                <img src={src} alt={image.filename} className="h-[72px] w-full bg-background object-contain" />
              ) : (
                <div className="flex h-[72px] items-center justify-center bg-background text-muted">{dataUrls.failed > 0 ? "読み込めません" : "読み込み中…"}</div>
              )}
              <div className="flex items-center justify-between gap-1 px-1.5 py-1">
                <span className="truncate text-muted">{image.filename === "(名前なし)" ? "埋め込み" : image.filename}</span>
                <a href={attachmentUrl(messageId, image.attachmentId!, "download")} download className="shrink-0 font-semibold text-accent">
                  ⬇ 保存
                </a>
              </div>
            </div>
          );
        })}
        {external.map((url) => (
          <div key={`x-${url}`} className={thumb}>
            {/* eslint-disable-next-line @next/next/no-img-element -- 外部の画像。表示を許した後だけ出す */}
            <img src={url} alt="" referrerPolicy="no-referrer" loading="lazy" className="h-[72px] w-full bg-background object-contain" />
            <div className="flex items-center justify-between gap-1 px-1.5 py-1">
              <span className="truncate text-muted">外部</span>
              <a href={url} target="_blank" rel="noopener noreferrer" className="shrink-0 font-semibold text-accent">
                ↗ 開く
              </a>
            </div>
          </div>
        ))}
      </div>
      <p className="px-1 text-[0.625rem] text-muted">外部の画像は元の場所を開きます（長押しなどで保存できます）。</p>
    </section>
  );
}
