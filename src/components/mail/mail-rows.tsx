"use client";

import { Star } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { mailAccountKeyOf, senderName, type MailAction, type MailLabel, type MailSummary } from "@/lib/mail/contract";
import { cn } from "@/lib/utils";

import { FLOW_KIND_META } from "@/lib/mail/flow-record-core";

import { MailAccountChip } from "./mail-account-chip";
import { mailTimeLabel } from "./mail-format";
import { MailNotice } from "./mail-notice";
import { leaveMailPane } from "./mail-transition";
import { SwipeArchiveRow } from "./swipe-archive-row";
import { useMailAction } from "./use-mail-action";

type Row = MailSummary & { notified: boolean; flowKinds: string[] };

type Props = {
  messages: Row[];
  labels: MailLabel[];
  supportsLabels: boolean;
  inTrash: boolean;
  /** 複数アカウントを混ぜて見せているとき、行にアカウントのチップを出し、別アカウントとの同時選択を止める。 */
  showAccount: boolean;
  /** 「◯分前」などの基準（サーバーで決めて渡す）。 */
  nowMs: number;
  /** 本文から一覧へ戻るときのURL。 */
  back: string;
};

const BULK: { action: MailAction; label: string }[] = [
  { action: "read", label: "既読にする" },
  { action: "unread", label: "未読にする" },
  { action: "archive", label: "アーカイブ" },
  { action: "star", label: "スター" },
];

/** 一覧の行とまとめての操作（#683）。選んだメールに既読・アーカイブ・ラベル・ゴミ箱をまとめて当てる。 */
export function MailRows({ messages, labels, supportsLabels, inTrash, showAccount, nowMs, back }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 押した行（#699）。本文の画面へ移るまでの一瞬、押したことが分かるよう色を付ける
  const [opening, setOpening] = useState<string | null>(null);
  const { apply, archiveRow, pending, notice } = useMailAction({ after: () => setSelected(new Set()) });
  const now = new Date(nowMs);
  const ids = [...selected];
  // 選択中のアカウント。AIDEは複数アカウントにまたがる操作を1件も変更せず断るので、同じアカウントの行だけ選べるようにする
  const selectedKey = showAccount && ids.length > 0 ? mailAccountKeyOf(ids[0]!) : null;
  const lockedOut = (id: string) => selectedKey !== null && mailAccountKeyOf(id) !== selectedKey;
  const selectedName = selectedKey ? (messages.find((m) => mailAccountKeyOf(m.id) === selectedKey)?.account ?? selectedKey) : null;
  // ラベルも `<鍵>~` 付き。選んだ行のアカウントのものだけ付けられる
  const userLabels = labels.filter(
    (label) => label.type === "user" && (selectedKey === null || mailAccountKeyOf(label.id) === selectedKey),
  );

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-2.5">
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-[10px] bg-topic-surface px-2.5 py-2 text-xs">
          <b className="mr-1 text-topic">
            {selectedName ? `${selectedName}・` : ""}
            {selected.size}通を選択中
          </b>
          {BULK.map(({ action, label }) => (
            <button key={action} type="button" disabled={pending} onClick={() => apply(action, ids)} className={bulkButton}>
              {label}
            </button>
          ))}
          {supportsLabels && userLabels.length > 0 && (
            <select
              aria-label="ラベルを付ける"
              disabled={pending}
              value=""
              onChange={(event) => event.target.value && apply("label-add", ids, event.target.value)}
              className={bulkButton}
            >
              <option value="">ラベルを付ける…</option>
              {userLabels.map((label) => (
                <option key={label.id} value={label.id}>
                  {label.name}
                </option>
              ))}
            </select>
          )}
          {inTrash ? (
            <button type="button" disabled={pending} onClick={() => apply("untrash", ids)} className={bulkButton}>
              ゴミ箱から戻す
            </button>
          ) : (
            <button type="button" disabled={pending} onClick={() => apply("trash", ids)} className={bulkButton}>
              ゴミ箱へ
            </button>
          )}
          <button type="button" onClick={() => setSelected(new Set())} className="ml-auto text-[0.6875rem] text-muted underline">
            選択を外す
          </button>
          {selectedKey && (
            <span className="basis-full text-[0.6875rem] text-muted">
              別のアカウントのメールは同時に選べません（薄く表示）。アカウントごとに選び直してください。
            </span>
          )}
        </div>
      )}
      <MailNotice notice={notice} />

      <ul className="overflow-hidden rounded-xl border border-border bg-surface">
        {messages.map((message) => {
          const locked = lockedOut(message.id);
          const accountKey = showAccount ? mailAccountKeyOf(message.id) : null;
          const href = `/mail/${encodeURIComponent(message.id)}?back=${encodeURIComponent(back)}`;
          return (
            <SwipeArchiveRow
              key={message.id}
              enabled={!inTrash && message.labelIds.includes("INBOX")}
              onArchive={() => archiveRow(message.id, message.unread)}
              className={cn(
                "flex items-start gap-2.5 px-3 py-2.5 transition-colors md:items-center md:px-3.5",
                opening === message.id ? "bg-accent-surface" : "bg-surface hover:bg-rail",
                locked && "opacity-45",
              )}
            >
              <input
                type="checkbox"
                checked={selected.has(message.id)}
                disabled={locked}
                onChange={() => toggle(message.id)}
                aria-label={`${senderName(message.from)}「${message.subject}」を選ぶ`}
                className="mt-1 size-4 shrink-0 accent-[var(--topic)] md:mt-0"
              />
              <Star
                className={cn("hidden size-3.5 shrink-0 md:block", message.starred ? "fill-yellow-400 text-yellow-500" : "text-border")}
                aria-label={message.starred ? "スター付き" : undefined}
                aria-hidden={message.starred ? undefined : true}
              />
              <Link
                href={href}
                onClick={(event) => {
                  if (leaveMailPane(event, "forward")) setOpening(message.id);
                }}
                className="grid min-w-0 flex-1 gap-0.5 md:grid-cols-[170px_1fr_auto] md:items-center md:gap-3">
                <span className="flex min-w-0 items-baseline justify-between gap-2 md:contents">
                  <span className={cn("truncate text-[0.8125rem]", message.unread && "font-bold")}>{senderName(message.from)}</span>
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-[0.6875rem] text-muted md:order-last md:text-right">
                    {/* 未読だけ丸印を付ける（Gmail方式。#713）。既読は透明で幅を揃え、日時の位置をずらさない */}
                    {message.unread ? (
                      <span role="img" aria-label="未読" className="size-2 shrink-0 rounded-full bg-accent" />
                    ) : (
                      <span aria-hidden="true" className="size-2 shrink-0" />
                    )}
                    {mailTimeLabel(message.receivedAt, now)}
                  </span>
                </span>
                <span className="line-clamp-2 min-w-0 text-xs text-muted md:line-clamp-1 md:text-[0.8125rem]">
                  {message.notified && <Chip className="bg-accent-surface text-accent">お知らせ済み</Chip>}
                  {message.flowKinds.map((kind) => {
                    const meta = FLOW_KIND_META[kind as keyof typeof FLOW_KIND_META];
                    return meta ? (
                      <Chip key={kind} className="bg-accent-surface text-accent">
                        {meta.icon} {meta.label}
                      </Chip>
                    ) : null;
                  })}
                  {accountKey && <MailAccountChip accountKey={accountKey} name={message.account ?? accountKey} className="mr-1.5" />}
                  <span className={cn("text-foreground", message.unread ? "font-bold" : "font-medium")}>
                    {message.subject || "（件名なし）"}
                  </span>
                  {message.snippet && <> — {message.snippet}</>}
                </span>
              </Link>
            </SwipeArchiveRow>
          );
        })}
      </ul>
    </div>
  );
}

const bulkButton =
  "rounded-[9px] border border-border bg-surface px-2.5 py-1.5 text-xs transition-colors hover:bg-rail-active disabled:opacity-50";

function Chip({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={cn("mr-1.5 inline-block rounded-full px-1.5 py-px align-[1px] text-[0.65625rem] font-bold", className)}>
      {children}
    </span>
  );
}
