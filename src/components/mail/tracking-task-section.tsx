"use client";

import { useEffect, useState } from "react";

import type { CardResult } from "@/components/mail/flow-sheet";
import type { TrackingFields } from "@/lib/mail/tracking-link";
import { isAttachableTracking, trackingMemoLines } from "@/lib/mail/tracking-task";
import { cn } from "@/lib/utils";

/**
 * 追跡のシートの「タスクに追跡番号を残す」（#1211）。未完了タスクを選んでメモに追記するか、番号入りの新しいタスクを作る。
 * **押すまで何も書かない。** AIが同じ用件と見たタスク（`fields.taskId`）、無ければこのメールに紐づけ済みの1件を最初から選ぶ。
 */

export type TrackingTaskTarget = { taskId: string; title: string; dateText: string | null };

type Candidate = { targetId: string; title: string; dateText: string | null; linked: boolean };

const NEW = "new";
const DEFAULT_TITLE = "荷物を受け取る";
const field = "box-border h-10 w-full min-w-0 appearance-none rounded-lg border border-border bg-background px-2.5 py-2 text-sm text-foreground [&::-webkit-date-and-time-value]:text-left";
const button = "rounded-[10px] bg-accent px-3 py-2.5 text-center text-sm font-bold text-accent-foreground transition-opacity disabled:opacity-50";

const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

export function TrackingTaskSection({
  mailId,
  tracking,
  outcome,
  running,
  onAppend,
  onCreate,
}: {
  mailId: string;
  tracking: TrackingFields;
  outcome: CardResult | undefined;
  running: boolean;
  onAppend: (target: TrackingTaskTarget) => void;
  onCreate: (title: string, planned: string | null) => void;
}) {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  /** 利用者が選んだもの。未操作はnull（候補から決めた既定を使う）。 */
  const [picked, setPicked] = useState<string | null>(null);
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [planned, setPlanned] = useState("");

  useEffect(() => {
    const abort = new AbortController();
    fetch(`/api/mail/links?id=${encodeURIComponent(mailId)}&kind=task`, { signal: abort.signal })
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as { items?: Candidate[]; error?: string } | null;
        if (response.ok && data?.items) setCandidates(data.items);
        else setLoadError(data?.error ?? "タスクを取得できませんでした。");
      })
      .catch(() => {
        if (!abort.signal.aborted) setLoadError("タスクを取得できませんでした（通信できませんでした）。");
      });
    return () => abort.abort();
  }, [mailId, reload]);

  const heading = <h3 className="border-t border-border pt-3 text-[0.8125rem] font-bold">📌 タスクに追跡番号を残す</h3>;

  if (outcome?.done) {
    return (
      <>
        {heading}
        {outcome.href && (
          <a href={outcome.href} target="_blank" rel="noopener noreferrer" className={button}>
            タスクを開く ↗
          </a>
        )}
      </>
    );
  }

  if (!isAttachableTracking(tracking)) {
    return (
      <>
        {heading}
        <p className="text-[0.6875rem] text-muted">配送会社と追跡番号をそろえると、タスクに残せます。</p>
      </>
    );
  }

  const hint = candidates?.find((c) => c.targetId === tracking.taskId);
  const linked = candidates?.filter((c) => c.linked) ?? [];
  // おすすめを先頭に出す
  const ordered = candidates ? [...candidates].sort((a, b) => Number(b === hint) - Number(a === hint)) : [];
  const fallback = hint?.targetId ?? (linked.length === 1 ? linked[0].targetId : candidates?.length === 0 ? NEW : null);
  // 一覧が取れなくても、新しいタスクは作れる
  const selected = picked ?? fallback;
  const target = candidates?.find((c) => c.targetId === selected);
  const option = (value: string, label: string, sub: string | null, recommended = false) => (
    <button
      key={value}
      type="button"
      role="radio"
      aria-checked={selected === value}
      disabled={running}
      onClick={() => setPicked(value)}
      className={cn("flex shrink-0 items-center gap-2 rounded-[10px] border px-2.5 py-2 text-left", selected === value ? "border-accent bg-accent-surface" : "border-border")}
    >
      <span aria-hidden className={cn("size-3.5 shrink-0 rounded-full border-2", selected === value ? "border-[5px] border-accent bg-surface" : "border-muted")} />
      <span className="min-w-0">
        <span className="break-words text-[0.8125rem] font-bold">{label}</span>
        {recommended && <span className="ml-1.5 rounded-full bg-accent px-2 py-0.5 text-[0.625rem] font-bold text-accent-foreground">おすすめ</span>}
        {sub && <span className="block text-[0.6875rem] text-muted">{sub}</span>}
      </span>
    </button>
  );

  return (
    <>
      {heading}
      {candidates === null && !loadError && <p className="text-[0.6875rem] text-muted">未完了のタスクを取得しています…</p>}
      {loadError && (
        <p role="alert" className="text-[0.6875rem] text-danger">
          {loadError}{" "}
          <button
            type="button"
            className="font-bold underline"
            onClick={() => {
              setLoadError(null);
              setReload((n) => n + 1);
            }}
          >
            取得し直す
          </button>
        </p>
      )}
      <div role="radiogroup" aria-label="追跡番号を残すタスク" className="flex flex-col gap-1.5">
        {/* タスクが多いときは中でスクロールし、「新しいタスクを作る」は常に見える位置に置く */}
        {ordered.length > 0 && (
          <div className="flex max-h-48 flex-col gap-1.5 overflow-y-auto">
            {ordered.map((c) => option(c.targetId, c.title, [c.dateText ? md(c.dateText) : "日付なし", c.linked ? "このメールに紐づけ済み" : null].filter(Boolean).join("・"), c === hint))}
          </div>
        )}
        {option(NEW, "＋ 新しいタスクを作る", "このメールから作る")}
      </div>

      {selected === NEW && (
        <>
          <label className="flex flex-col gap-1 text-[0.6875rem] text-muted">
            タイトル
            <input className={field} maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-[0.6875rem] text-muted">
            予定日（任意）
            <input type="date" className={field} value={planned} onChange={(e) => setPlanned(e.target.value)} />
          </label>
        </>
      )}

      {selected !== null && (
        <div className="rounded-[10px] border border-dashed border-border px-2.5 py-2 text-xs [overflow-wrap:anywhere]">
          <p className="text-[0.6875rem] text-muted">{selected === NEW ? "メモに入る内容（このメールの件名・リンクも入ります）" : "メモの末尾にこれを書き足します（今のメモは残ります）"}</p>
          {trackingMemoLines(tracking).map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}

      <button
        type="button"
        className={button}
        disabled={running || (selected === NEW ? title.trim() === "" : !target)}
        onClick={() => {
          if (selected === NEW) onCreate(title.trim(), planned || null);
          else if (target) onAppend({ taskId: target.targetId, title: target.title, dateText: target.dateText });
        }}
      >
        {running ? "実行しています…" : selected === NEW ? "タスクを作る" : target ? "このタスクのメモに追記する" : "タスクを選んでください"}
      </button>
    </>
  );
}
