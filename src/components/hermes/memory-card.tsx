"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Highlighted, IssueList, ReviewActions, SensitiveWarning } from "@/components/hermes/review-parts";
import {
  detectSensitive,
  hasBlockingMemoryIssue,
  MEMORY_ACTION_LABELS,
  MEMORY_TARGET_LABELS,
  memoryReviewText,
  memoryTitle,
  validatePendingMemory,
  type MemoryEntry,
  type PendingMemory,
} from "@/lib/hermes/memory-core";

function PendingCard({ memory }: { memory: PendingMemory }) {
  const issues = validatePendingMemory(memory);
  const blocked = hasBlockingMemoryIssue(issues);
  const hits = detectSensitive(memoryReviewText(memory));

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4" aria-label={`確認待ち: ${memoryTitle(memory)}`}>
      <header className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">{memoryTitle(memory)}</h3>
        <p className="text-xs text-muted">
          {memory.origin === "background_review" ? "Hermesが会話の後で自動で見直して作った案" : "会話の中でHermesが作った案"}
          {memory.createdAt ? `・${new Date(memory.createdAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}` : ""}
        </p>
      </header>

      <IssueList issues={issues} />

      <SensitiveWarning hits={hits} where="覚える内容" />

      {memory.ops.map((op, index) => {
        const before = op.matchedEntry ?? op.oldText;
        return (
          <div key={index} className="flex flex-col gap-1">
            <p className="text-xs font-medium">
              {MEMORY_TARGET_LABELS[op.target]}・{MEMORY_ACTION_LABELS[op.action]}
            </p>
            {op.action !== "add" && before && (
              <p className="whitespace-pre-wrap break-words rounded-lg bg-background px-3 py-2 text-xs text-muted">
                <span className="mr-1 font-medium">対象:</span>
                {before}
              </p>
            )}
            {op.action !== "remove" && op.content !== undefined && (
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background px-3 py-2 text-xs">
                <Highlighted text={op.content} hits={hits} />
              </pre>
            )}
          </div>
        );
      })}

      <ReviewActions
        endpoint={`/api/hermes/memory/pending/${memory.id}`}
        blocked={blocked}
        approveLabel="承認して覚える"
        confirmLabel="個人情報・認証情報・他人から届いた指示を含んでいないことを確認した"
      />
    </section>
  );
}

function EntryRow({ entry }: { entry: MemoryEntry }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function remove() {
    if (!window.confirm("この記憶を削除します。元に戻せません。")) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/hermes/memory/entries", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: entry.target, text: entry.text }),
      });
      if (response.ok) {
        router.refresh();
        return;
      }
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      setMessage(data?.error ?? "削除できませんでした。");
    } catch {
      setMessage("通信できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="whitespace-pre-wrap break-words text-sm">{entry.text}</p>
        {message && (
          <p role="alert" className="text-xs text-red-500">
            {message}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => void remove()}
        disabled={busy}
        aria-label="この記憶を削除"
        className="shrink-0 rounded-lg p-2 text-muted hover:bg-rail-active disabled:opacity-40"
      >
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Trash2 className="size-4" aria-hidden="true" />}
      </button>
    </li>
  );
}

/** 記憶の画面（#1155）。承認待ちのカードと、保存済みの記憶の一覧（1項目ずつ削除できる）。 */
export function MemoryView({ pending, entries, error }: { pending: PendingMemory[]; entries: MemoryEntry[]; error: string | null }) {
  const groups = (["user", "memory"] as const).map((target) => ({ target, items: entries.filter((entry) => entry.target === target) }));
  return (
    <>
      <div>
        <h1 className="text-lg font-semibold">記憶</h1>
        <p className="mt-1 text-xs text-muted">
          Hermesが「次からも覚えておく」案を、内容を確かめてから保存します。承認するまで、記憶は1つも保存されません。
          承認・削除は<strong>新しい会話から</strong>効きます（会話の途中では反映されません）。
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">
          取得できませんでした: {error}
        </p>
      )}

      {!error && (
        <>
          <section className="flex flex-col gap-3" aria-label="確認待ち">
            <h2 className="text-sm font-semibold">確認待ち（{pending.length}件）</h2>
            {pending.length === 0 && <p className="text-xs text-muted">確認待ちの記憶の案はありません。7日以上放置した案は自動で消えます。</p>}
            {pending.map((memory) => (
              <PendingCard key={memory.id} memory={memory} />
            ))}
          </section>

          {groups.map(({ target, items }) => (
            <section key={target} aria-label={MEMORY_TARGET_LABELS[target]}>
              <h2 className="text-sm font-semibold">
                {MEMORY_TARGET_LABELS[target]}（{items.length}件）
              </h2>
              {items.length === 0 ? (
                <p className="mt-1 text-xs text-muted">まだありません。</p>
              ) : (
                <ul className="mt-1 divide-y divide-border">
                  {items.map((entry) => (
                    <EntryRow key={`${entry.target}:${entry.text}`} entry={entry} />
                  ))}
                </ul>
              )}
            </section>
          ))}
        </>
      )}
    </>
  );
}
