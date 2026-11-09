"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { FLOW_APP_LINKS } from "@/lib/mail/app-links";
import { LINK_KIND_META, LINK_SOURCE_LABELS, type LinkKind, type LinkView } from "@/lib/mail/link-core";
import { cn } from "@/lib/utils";

/**
 * このメールに紐づけた予定・タスク（#834）と、既存の予定・タスクへの紐づけ（ハーフモーダル）。
 * 紐づけは操作の控えで、予定・タスクそのものは変えない。メールから作ったものは作成時に自動で入る（`source: created`）。
 * 型だけをimportする（`link-core.ts` の値はクライアントでも読めるが、サーバー専用の依存は持ち込まない）。
 */

type Candidate = { kind: LinkKind; targetId: string; calendarId: string | null; title: string; dateText: string | null; time: string | null; linked: boolean };

const md = (date: string | null) => {
  const m = date ? /^\d{4}-(\d{2})-(\d{2})$/.exec(date) : null;
  return m ? `${Number(m[1])}/${Number(m[2])}` : null;
};

export function MailLinks({ id, links }: { id: string; links: LinkView[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(links);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // サーバー側の再描画（メールから作成した直後など）は、呼び出し側が一覧の中身を `key` にして作り直す

  async function unlink(link: LinkView) {
    setBusy(link.id);
    setError(null);
    try {
      const response = await fetch("/api/mail/links", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ linkId: link.id }) });
      if (!response.ok) throw new Error();
      setRows((current) => current.filter((l) => l.id !== link.id));
      router.refresh();
    } catch {
      setError("紐づけを外せませんでした。時間をおいて試してください。");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label="このメールに紐づけた予定・タスク" className="rounded-[10px] border border-accent/30 bg-surface px-3 py-2.5 text-xs leading-relaxed">
      <b className="text-accent">🔗 このメールに紐づけた予定・タスク</b>
      {rows.length === 0 ? (
        <p className="mt-1 text-muted">まだ紐づけた予定・タスクはありません。</p>
      ) : (
        <ul className="mt-1 flex flex-col">
          {rows.map((link) => {
            const meta = LINK_KIND_META[link.kind];
            const app = FLOW_APP_LINKS[link.kind];
            return (
              <li key={link.id} className="flex items-center gap-2 border-t border-border/60 py-1.5 first:border-t-0">
                <span aria-hidden>{meta.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="break-words text-[0.8125rem]">{link.title}</span>
                  <br />
                  <span className="text-[0.6875rem] text-muted">
                    {meta.label}
                    {md(link.dateText) && `　${md(link.dateText)}`}　<span className="rounded-full bg-accent-surface px-1.5 py-px text-accent">{LINK_SOURCE_LABELS[link.source]}</span>
                  </span>
                </span>
                <a href={app.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-accent hover:underline">
                  開く ↗
                </a>
                <button type="button" disabled={busy === link.id} onClick={() => unlink(link)} className="shrink-0 text-muted hover:text-danger disabled:opacity-50">
                  解除
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {error && (
        <p role="alert" className="mt-1 text-danger">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 rounded-[10px] border border-border bg-background px-3 py-1.5 text-xs font-bold text-accent transition-colors hover:bg-rail-active"
      >
        ＋ 既存の予定・タスクに紐づける
      </button>
      <p className="mt-1 text-[0.6875rem] text-muted">紐づけはMorrowの控えです。予定・タスクそのものは変わりません。</p>
      {open && (
        <PickerSheet
          id={id}
          linked={rows}
          onClose={() => setOpen(false)}
          onLinked={(next) => {
            setRows(next);
            router.refresh();
          }}
        />
      )}
    </section>
  );
}

/** 紐づけ先を選ぶハーフモーダル。開いたときに候補を取る。 */
function PickerSheet({ id, linked, onClose, onLinked }: { id: string; linked: LinkView[]; onClose: () => void; onLinked: (links: LinkView[]) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [kind, setKind] = useState<LinkKind>("event");
  const [items, setItems] = useState<Candidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    fetch(`/api/mail/links?id=${encodeURIComponent(id)}&kind=${kind}`, { signal: abort.signal })
      .then(async (response) => {
        const json = (await response.json().catch(() => null)) as { items?: Candidate[]; error?: string } | null;
        if (!response.ok || !json?.items) throw new Error(json?.error ?? "候補を取得できませんでした。");
        setItems(json.items);
      })
      .catch((e: unknown) => {
        if (abort.signal.aborted) return;
        setError(e instanceof Error && e.message ? e.message : "候補を取得できませんでした。");
      });
    return () => abort.abort();
  }, [id, kind]);

  async function link(item: Candidate) {
    const key = `${item.kind}:${item.targetId}`;
    setBusy(key);
    setError(null);
    try {
      const response = await fetch("/api/mail/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, kind: item.kind, targetId: item.targetId, calendarId: item.calendarId, title: item.title, dateText: item.dateText }),
      });
      const json = (await response.json().catch(() => null)) as { links?: LinkView[]; error?: string } | null;
      if (!response.ok || !json?.links) throw new Error(json?.error ?? "紐づけできませんでした。");
      setDone((current) => new Set(current).add(key));
      onLinked(json.links);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "紐づけできませんでした。");
    } finally {
      setBusy(null);
    }
  }

  const isLinked = (item: Candidate) => item.linked || done.has(`${item.kind}:${item.targetId}`) || linked.some((l) => l.kind === item.kind && l.targetId === item.targetId);

  return (
    <dialog
      ref={ref}
      aria-label="既存の予定・タスクに紐づける"
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
      className="flow-sheet fixed inset-x-0 bottom-0 top-auto m-0 mx-auto max-h-[85dvh] w-full max-w-[560px] overflow-y-auto rounded-t-[18px] border border-border bg-surface p-0 text-foreground backdrop:bg-black/55"
    >
      <div className="flex flex-col gap-3 px-4 pb-[calc(1.25rem+var(--app-bottom-inset))] pt-2">
        <div aria-hidden className="mx-auto h-[5px] w-10 rounded-full bg-border" />
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[0.9375rem] font-bold">🔗 既存の予定・タスクに紐づける</h2>
          <button type="button" onClick={() => ref.current?.close()} aria-label="閉じる" className="rounded-md px-2 py-1 text-lg leading-none text-muted hover:bg-rail-active">
            ✕
          </button>
        </div>
        <div role="tablist" className="flex gap-1.5">
          {(["event", "task"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              onClick={() => {
                setItems(null);
                setError(null);
                setKind(k);
              }}
              className={cn("rounded-full border px-3.5 py-1 text-sm", kind === k ? "border-accent bg-accent text-accent-foreground" : "border-border")}
            >
              {LINK_KIND_META[k].label}
            </button>
          ))}
        </div>
        <p className="text-[0.6875rem] text-muted">{kind === "event" ? "今日の前後1週間ほどの予定です。" : "未完了のタスクです。"}</p>

        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
        {!error && items === null && <p className="text-xs text-muted">取得しています…</p>}
        {items && items.length === 0 && !error && <p className="text-xs text-muted">候補がありません。</p>}
        {items && items.length > 0 && (
          <ul className="flex flex-col">
            {items.map((item) => {
              const key = `${item.kind}:${item.targetId}`;
              const already = isLinked(item);
              return (
                <li key={key} className="flex items-center gap-2 border-t border-border/60 py-2 first:border-t-0">
                  <span className="min-w-0 flex-1 text-[0.8125rem]">
                    <span className="break-words">{item.title}</span>
                    <br />
                    <span className="text-[0.6875rem] text-muted">
                      {md(item.dateText) ?? "日付なし"}
                      {item.time && ` ${item.time}`}
                    </span>
                  </span>
                  {already ? (
                    <span className="shrink-0 rounded-full bg-accent-surface px-2 py-0.5 text-[0.6875rem] text-accent">紐づけ済み</span>
                  ) : (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => link(item)}
                      className="shrink-0 rounded-[10px] bg-accent px-3 py-1.5 text-xs font-bold text-accent-foreground disabled:opacity-50"
                    >
                      {busy === key ? "…" : "紐づける"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </dialog>
  );
}
