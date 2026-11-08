"use client";

import { Star } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { senderName, type MailAction, type MailLabel, type MailSummary } from "@/lib/mail/contract";
import { cn } from "@/lib/utils";

import { mailTimeLabel } from "./mail-format";
import { MailNotice } from "./mail-notice";
import { leaveMailPane } from "./mail-transition";
import { useMailAction } from "./use-mail-action";

type Row = MailSummary & { notified: boolean };

type Props = {
  messages: Row[];
  labels: MailLabel[];
  supportsLabels: boolean;
  inTrash: boolean;
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
export function MailRows({ messages, labels, supportsLabels, inTrash, nowMs, back }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 押した行（#699）。本文の画面へ移るまでの一瞬、押したことが分かるよう色を付ける
  const [opening, setOpening] = useState<string | null>(null);
  const { apply, pending, notice } = useMailAction({ after: () => setSelected(new Set()) });
  const now = new Date(nowMs);
  const userLabels = labels.filter((label) => label.type === "user");

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const ids = [...selected];

  return (
    <div className="flex flex-col gap-2.5">
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-[10px] bg-topic-surface px-2.5 py-2 text-xs">
          <b className="mr-1 text-topic">{selected.size}通を選択中</b>
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
        </div>
      )}
      <MailNotice notice={notice} />

      <ul className="overflow-hidden rounded-xl border border-border bg-surface">
        {messages.map((message) => {
          const href = `/mail/${encodeURIComponent(message.id)}?back=${encodeURIComponent(back)}`;
          return (
            <li
              key={message.id}
              className={cn(
                "flex items-start gap-2.5 border-t border-border px-3 py-2.5 transition-colors first:border-t-0 md:items-center md:px-3.5",
                opening === message.id ? "bg-accent-surface" : "hover:bg-rail",
              )}
            >
              <input
                type="checkbox"
                checked={selected.has(message.id)}
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
                  <span className="shrink-0 text-[0.6875rem] text-muted md:order-last md:text-right">
                    {mailTimeLabel(message.receivedAt, now)}
                  </span>
                </span>
                <span className="line-clamp-2 min-w-0 text-xs text-muted md:line-clamp-1 md:text-[0.8125rem]">
                  {message.notified && <Chip className="bg-accent-surface text-accent">お知らせ済み</Chip>}
                  {message.account && <Chip className="bg-topic-surface text-topic">{message.account}</Chip>}
                  <span className={cn("text-foreground", message.unread ? "font-bold" : "font-medium")}>
                    {message.subject || "（件名なし）"}
                  </span>
                  {message.snippet && <> — {message.snippet}</>}
                </span>
              </Link>
            </li>
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
