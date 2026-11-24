"use client";

import { ImagePlus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { checkImageBase64, IMAGE_JPEG_QUALITY, IMAGE_MAX_EDGE, TURN_IMAGE_MAX_BYTES, TURN_IMAGE_MAX_COUNT } from "@/lib/hermes/image-core";

/** 送る前の画像1枚。`data` はbase64（`data:` の枠なし）、`preview` はサムネイル用のobject URL。 */
export interface AttachedImage {
  id: number;
  data: string;
  preview: string;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.readAsDataURL(blob);
  });
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/**
 * 画像を長辺 {@link IMAGE_MAX_EDGE}px・JPEGへ縮める（#1157）。HEICなどブラウザが読める形式はここでJPEGになる。
 * 読めない形式（`createImageBitmap` が断る）は理由つきで例外にする。容量を超えたら品質・大きさを下げて作り直す。
 */
export async function shrinkImage(file: File): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`「${file.name}」は読み込めない形式です（PNG・JPEG・GIF・WebP・HEICに対応）。`);
  }
  try {
    for (const [edge, quality] of [
      [IMAGE_MAX_EDGE, IMAGE_JPEG_QUALITY],
      [IMAGE_MAX_EDGE, 0.6],
      [1200, 0.6],
      [900, 0.5],
    ] as const) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("画像を縮小できませんでした。");
      // 透過のPNGはJPEGにすると黒くなるので、白で下地を敷く
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await canvasBlob(canvas, quality);
      if (blob && blob.size <= TURN_IMAGE_MAX_BYTES) return blobToBase64(blob);
    }
  } finally {
    bitmap.close();
  }
  throw new Error(`「${file.name}」は大きすぎて縮められませんでした。`);
}

/** 添付の状態。取り消し・送信後のクリア・送信失敗時の戻しを持つ。 */
export function useImageAttachments() {
  const [items, setItems] = useState<AttachedImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nextId = useRef(1);
  const itemsRef = useRef<AttachedImage[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(
    () => () => {
      for (const item of itemsRef.current) URL.revokeObjectURL(item.preview);
    },
    [],
  );

  const add = useCallback(async (files: File[]) => {
    setError(null);
    setBusy(true);
    try {
      const room = TURN_IMAGE_MAX_COUNT - itemsRef.current.length;
      if (files.length > room) setError(`画像は${TURN_IMAGE_MAX_COUNT}枚までです。${room > 0 ? `先頭の${room}枚だけ添付しました。` : ""}`);
      const added: AttachedImage[] = [];
      for (const file of files.slice(0, Math.max(0, room))) {
        try {
          const data = await shrinkImage(file);
          // サーバーと同じ検査を通ってから並べる
          const checked = checkImageBase64(data);
          if (!checked.ok) throw new Error(checked.reason);
          const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
          added.push({ id: nextId.current++, data, preview: URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" })) });
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "画像を添付できませんでした。");
        }
      }
      if (added.length > 0) setItems((current) => [...current, ...added].slice(0, TURN_IMAGE_MAX_COUNT));
    } finally {
      setBusy(false);
    }
  }, []);

  const remove = useCallback((id: number) => {
    setItems((current) => {
      const target = current.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.preview);
      return current.filter((item) => item.id !== id);
    });
  }, []);

  /** 送った後に空にする（サムネイルのURLは送信中も使うので解放しない。戻すときに再利用する）。 */
  const take = useCallback((): AttachedImage[] => {
    const taken = itemsRef.current;
    setItems([]);
    setError(null);
    return taken;
  }, []);

  /** 送れなかったとき、`take()` で取った画像を戻す。 */
  const restore = useCallback((taken: AttachedImage[]) => setItems(taken), []);

  /** 送信が済んだ（もう戻さない）。サムネイルのURLを解放する。 */
  const release = useCallback((taken: AttachedImage[]) => {
    for (const item of taken) URL.revokeObjectURL(item.preview);
  }, []);

  return { items, error, busy, add, remove, take, restore, release };
}

type Attachments = ReturnType<typeof useImageAttachments>;

/** サムネイル・取り消し・個人情報の注意・エラー。入力欄の上に置く。 */
export function ImageAttachThumbs({ attachments, disabled }: { attachments: Attachments; disabled: boolean }) {
  const { items, error, remove } = attachments;
  if (items.length === 0 && !error) return null;
  return (
    <div className="mx-auto mb-2 max-w-[760px]">
      {items.length > 0 && (
        <>
          <ul className="flex gap-2 overflow-x-auto pb-1">
            {items.map((item, index) => (
              <li key={item.id} className="relative shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.preview} alt={`添付する画像 ${index + 1}`} className="size-16 rounded-lg border border-border object-cover" />
                <button
                  type="button"
                  onClick={() => remove(item.id)}
                  disabled={disabled}
                  aria-label={`画像 ${index + 1} を取り消す`}
                  className="absolute -right-1.5 -top-1.5 inline-flex size-5 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-sm"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted">この画像はHermesへ渡されます。口座番号・住所などが写っていないか確かめてから送ってください。</p>
        </>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

/** 添付ボタン。`<input type="file" accept="image/*">` はiOSでは写真ライブラリ・撮影・ファイルの選択になる。 */
export function ImageAttachButton({ attachments, disabled }: { attachments: Attachments; disabled: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { items, busy, add } = attachments;
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length > 0) void add(files);
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || busy || items.length >= TURN_IMAGE_MAX_COUNT}
        aria-label="画像を添付する"
        title={`画像を添付する（${TURN_IMAGE_MAX_COUNT}枚まで）`}
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-foreground disabled:opacity-45"
      >
        <ImagePlus className="size-4" aria-hidden="true" />
      </button>
    </>
  );
}
