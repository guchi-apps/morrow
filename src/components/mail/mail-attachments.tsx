"use client";

import { useEffect, useRef, useState } from "react";

import { sizeLabel } from "@/components/mail/mail-format";
import { checkAttachmentName, categoryLabel, categoryOf, type AttachmentCategory, type AttachmentCheck } from "@/lib/mail/attachment-check";
import { attachmentUrl } from "@/lib/mail/body-images";
import type { MailAttachment } from "@/lib/mail/contract";
import { cn } from "@/lib/utils";

/**
 * 添付ファイルの一覧（#1101）。
 *
 * - ファイル名だけで分かる危険（実行形式・二重拡張子）は開いた時点で出す（`checkAttachmentName()`）
 * - 「保存」「見る」を押すと、Morrowのサーバーが中身を検査（`?mode=check`）してから進める。`caution` は理由のシートで確かめてから保存、
 *   `danger` は保存させない。開けるのは検査で問題が無かった画像・PDFだけ
 * - `attachmentId` が無い（AIDEの取り出し口が無い版）ものはファイル名だけ
 */

type RowState =
  | { status: "idle" }
  | { status: "checking"; then: "download" | "view" }
  | { status: "done"; check: AttachmentCheck }
  | { status: "error"; message: string };

const ICON: Record<AttachmentCategory, { label: string; className: string }> = {
  pdf: { label: "PDF", className: "bg-[#b91c1c]" },
  image: { label: "画像", className: "bg-[#2563eb]" },
  archive: { label: "ZIP", className: "bg-[#7c3aed]" },
  office: { label: "文書", className: "bg-[#0d9488]" },
  executable: { label: "EXE", className: "bg-[#475569]" },
  web: { label: "WEB", className: "bg-[#b7791f]" },
  text: { label: "TXT", className: "bg-[#64748b]" },
  other: { label: "FILE", className: "bg-[#64748b]" },
};

export function MailAttachments({ messageId, attachments }: { messageId: string; attachments: MailAttachment[] }) {
  const [rows, setRows] = useState<Record<number, RowState>>({});
  const [confirm, setConfirm] = useState<{ index: number; check: AttachmentCheck } | null>(null);
  const [viewing, setViewing] = useState<{ src: string; name: string } | null>(null);

  if (attachments.length === 0) return null;

  const update = (index: number, state: RowState) => setRows((prev) => ({ ...prev, [index]: state }));

  const run = async (index: number, then: "download" | "view") => {
    const file = attachments[index]!;
    if (!file.attachmentId) return;
    const current = rows[index];
    let check: AttachmentCheck;
    if (current?.status === "done") {
      check = current.check;
    } else {
      update(index, { status: "checking", then });
      try {
        const response = await fetch(attachmentUrl(messageId, file.attachmentId, "check", { name: file.filename, type: file.mimeType }));
        const json = (await response.json().catch(() => null)) as { check?: AttachmentCheck; error?: string } | null;
        if (!response.ok || !json?.check) {
          update(index, { status: "error", message: json?.error ?? "ファイルを確かめられませんでした。" });
          return;
        }
        check = json.check;
        update(index, { status: "done", check });
      } catch {
        update(index, { status: "error", message: "通信できませんでした。時間をおいてやり直してください。" });
        return;
      }
    }

    if (then === "view") {
      if (check.verdict !== "safe" || !check.preview) return;
      const src = attachmentUrl(messageId, file.attachmentId, "view");
      if (check.preview === "image") setViewing({ src, name: file.filename });
      else window.open(src, "_blank", "noopener");
      return;
    }
    if (check.verdict === "danger") return;
    if (check.verdict === "caution") {
      setConfirm({ index, check });
      return;
    }
    startDownload(attachmentUrl(messageId, file.attachmentId, "download"));
  };

  return (
    <section className="border-t border-border px-4 py-2.5" aria-label="添付ファイル">
      <h3 className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2 text-xs font-semibold text-muted">
        <span>添付ファイル（{attachments.length}）</span>
        <span className="text-[0.6875rem] font-normal">保存を押すと中身を検査してから保存します</span>
      </h3>
      <ul className="flex flex-col">
        {attachments.map((file, index) => (
          <AttachmentRow
            key={`${file.attachmentId ?? "n"}-${index}`}
            file={file}
            state={rows[index] ?? { status: "idle" }}
            onDownload={() => void run(index, "download")}
            onView={() => void run(index, "view")}
            onConfirm={(check) => setConfirm({ index, check })}
          />
        ))}
      </ul>
      <p className="mt-1.5 text-[0.625rem] leading-relaxed text-muted">
        検査はファイルの形式と中身の構造を見る簡易チェックで、ウイルス対策ソフトの代わりではありません。差出人に心当たりが無いファイルは開かないでください。
      </p>
      <CautionSheet
        target={confirm ? { name: attachments[confirm.index]!.filename, check: confirm.check } : null}
        onClose={() => setConfirm(null)}
        onAccept={() => {
          const file = confirm ? attachments[confirm.index] : null;
          setConfirm(null);
          if (file?.attachmentId) startDownload(attachmentUrl(messageId, file.attachmentId, "download", { confirm: "1" }));
        }}
      />
      <ImageViewer image={viewing} onClose={() => setViewing(null)} />
    </section>
  );
}

function startDownload(href: string) {
  const link = document.createElement("a");
  link.href = href;
  link.download = "";
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

const button = "rounded-[9px] border border-border bg-surface px-2.5 py-1 text-xs text-foreground hover:bg-rail-active disabled:opacity-45";

function AttachmentRow({
  file,
  state,
  onDownload,
  onView,
  onConfirm,
}: {
  file: MailAttachment;
  state: RowState;
  onDownload: () => void;
  onView: () => void;
  onConfirm: (check: AttachmentCheck) => void;
}) {
  const category = categoryOf(file.filename, file.mimeType);
  const icon = ICON[category];
  const byName = checkAttachmentName(file.filename, file.mimeType);
  const check = state.status === "done" ? state.check : null;
  const verdict = check?.verdict ?? (byName.verdict === "danger" ? "danger" : null);
  const reasons = check?.reasons ?? (byName.verdict === "danger" ? byName.reasons : []);
  const checking = state.status === "checking";
  const viewable = (category === "image" || category === "pdf") && (check ? check.preview !== null : verdict !== "danger");
  const available = file.attachmentId !== null;

  return (
    <li className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-dashed border-border py-2 last:border-b-0 sm:flex-nowrap">
      <span aria-hidden className={cn("flex h-10 w-[34px] shrink-0 items-center justify-center rounded-md text-[0.5625rem] font-bold text-white", icon.className)}>
        {icon.label}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-1.5 text-[0.8125rem] font-semibold">
          <span className="min-w-0 break-all">{file.filename || "（名前なし）"}</span>
          <VerdictBadge verdict={verdict} checking={checking} available={available} />
        </p>
        <p className="text-[0.6875rem] text-muted">
          {check?.kindLabel ?? categoryLabel(category)}・{sizeLabel(file.size)}
        </p>
        {verdict && verdict !== "safe" && reasons.length > 0 && (
          <p className={cn("mt-1 rounded-md px-2 py-1 text-[0.6875rem]", verdict === "danger" ? "bg-danger-surface text-danger" : "bg-[#fdf3dc] text-[#8a5a12] dark:bg-[#3a2e14] dark:text-[#f0c674]")}>
            {reasons.join(" ")}
            {verdict === "danger" && " Morrowからは保存できません。"}
          </p>
        )}
        {state.status === "error" && <p className="mt-1 text-[0.6875rem] text-danger">{state.message}</p>}
        {!available && <p className="mt-0.5 text-[0.6875rem] text-muted">このメールの添付は、まだ取り出せません。</p>}
      </div>
      {available && (
        <div className="ml-auto flex shrink-0 gap-1.5">
          {viewable && (
            <button type="button" className={button} onClick={onView} disabled={checking}>
              👁 見る
            </button>
          )}
          {verdict === "danger" ? (
            <button type="button" className={button} disabled>
              保存できません
            </button>
          ) : verdict === "caution" && check ? (
            <button type="button" className={button} onClick={() => onConfirm(check)}>
              詳しく・保存
            </button>
          ) : (
            <button type="button" className={cn(button, verdict === "safe" && "border-accent bg-accent text-accent-foreground hover:bg-accent")} onClick={onDownload} disabled={checking}>
              {checking ? "検査中…" : "⬇ 保存"}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function VerdictBadge({ verdict, checking, available }: { verdict: AttachmentCheck["verdict"] | null; checking: boolean; available: boolean }) {
  const base = "inline-flex items-center rounded-full px-2 py-px text-[0.6875rem] font-semibold";
  if (checking) return <span className={cn(base, "bg-background text-muted")}>検査中…</span>;
  if (verdict === "danger") return <span className={cn(base, "bg-danger-surface text-danger")}>✕ 危険</span>;
  if (verdict === "caution") return <span className={cn(base, "bg-[#fdf3dc] text-[#8a5a12] dark:bg-[#3a2e14] dark:text-[#f0c674]")}>! 注意</span>;
  if (verdict === "safe") return <span className={cn(base, "bg-fair-surface text-fair")}>✓ 問題は見つかりませんでした</span>;
  if (!available) return null;
  return <span className={cn(base, "bg-background text-muted")}>未検査</span>;
}

/** 「注意」のファイルを保存する前の確認（下から出るシート。#1020のキーボード対応の指定も揃える）。 */
function CautionSheet({ target, onClose, onAccept }: { target: { name: string; check: AttachmentCheck } | null; onClose: () => void; onAccept: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (target && !dialog.open) dialog.showModal();
    if (!target && dialog.open) dialog.close();
  }, [target]);

  return (
    <dialog
      ref={ref}
      aria-label="注意が必要なファイル"
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
      className="flow-sheet fixed inset-x-0 bottom-[var(--keyboard-inset)] top-auto m-0 mx-auto max-h-[min(85dvh,calc(var(--app-height)-1rem))] w-full max-w-[560px] overflow-y-auto rounded-t-[18px] border border-border bg-surface p-0 text-foreground backdrop:bg-black/55"
    >
      {target && (
        <div className="flex flex-col gap-3 px-4 pb-[calc(1.25rem+var(--app-bottom-inset))] pt-2">
          <div aria-hidden className="mx-auto h-[5px] w-10 rounded-full bg-border" />
          <h2 className="break-all text-[0.9375rem] font-bold">! {target.name} は注意が必要です</h2>
          <ul className="list-disc pl-5 text-[0.8125rem] leading-relaxed">
            {target.check.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <p className="text-xs text-muted">差出人に心当たりがあり、内容に見当が付く場合だけ保存してください。</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => ref.current?.close()} className="flex-1 rounded-[10px] border border-border bg-surface px-3 py-2.5 text-sm">
              やめる
            </button>
            <button type="button" onClick={onAccept} className="flex-1 rounded-[10px] border border-[#b7791f] bg-surface px-3 py-2.5 text-sm text-[#8a5a12] dark:text-[#f0c674]">
              理解して保存する
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}

/** 画像の添付をその場で見る。 */
function ImageViewer({ image, onClose }: { image: { src: string; name: string } | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (image && !dialog.open) dialog.showModal();
    if (!image && dialog.open) dialog.close();
  }, [image]);

  return (
    <dialog
      ref={ref}
      aria-label={image?.name ?? "画像"}
      onClose={onClose}
      onClick={() => ref.current?.close()}
      className="m-auto max-h-[90dvh] max-w-[min(960px,95vw)] rounded-xl border border-border bg-surface p-2 text-foreground backdrop:bg-black/70"
    >
      {image && (
        <figure className="flex flex-col gap-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element -- Morrowの中継から取る添付の画像 */}
          <img src={image.src} alt={image.name} className="max-h-[80dvh] w-auto max-w-full object-contain" />
          <figcaption className="break-all text-center text-[0.6875rem] text-muted">{image.name}（押すと閉じます）</figcaption>
        </figure>
      )}
    </dialog>
  );
}
