"use client";

import { Check, CircleAlert, Loader2 } from "lucide-react";
import { useState } from "react";

import { ChatMarkdown } from "@/components/hermes/chat-markdown";
import { ProposalCard } from "@/components/hermes/proposal-card";
import type { ClarifyAnswer, ClarifyQuestion } from "@/lib/hermes/contract";
import { splitLinks } from "@/lib/hermes/linkify";
import type { ProposalView } from "@/lib/hermes/proposal-core";
import type { ChatItem } from "@/lib/hermes/stream-view";

/** チャットの並びの1要素（#794）。吹き出し・道具のチップ・結果カード・確認カード・Hermesの承認・質問・お知らせ。 */

type Props = {
  item: ChatItem;
  /** 実行中のターン。Hermesの承認の宛先。 */
  turnId: string | null;
  onApproval: (requestId: string, choice: "once" | "deny") => void;
  /** 選択肢つきの質問に答えた（送れたあと。#1150）。 */
  onClarify: (requestId: string, answers: Record<string, ClarifyAnswer>) => void;
  onProposalChange: (proposal: ProposalView) => void;
  /** 失敗したターンの再送（#1158）。押せるのは最後の失敗通知で、実行中でないときだけ渡る。無ければボタンを出さない。 */
  onRetry?: (retry: { text: string; risky: boolean }) => void;
  /** 道具の経過秒の基準になる現在時刻（1秒ごとに更新される。#1158）。 */
  now: number;
};

export function ChatItemView({ item, turnId, onApproval, onClarify, onProposalChange, onRetry, now }: Props) {
  switch (item.kind) {
    case "user":
      return (
        <div className="max-w-[85%] self-end whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-accent px-3.5 py-2 text-sm text-white">
          {item.images ? <span className="mb-0.5 block text-xs opacity-85">画像 {item.images} 枚</span> : null}
          {item.text}
        </div>
      );

    case "assistant":
      return (
        <div className="min-w-0 max-w-[88%] self-start rounded-2xl rounded-bl-sm border border-border bg-surface px-3.5 py-2">
          <ChatMarkdown text={item.text} streaming={!item.done} />
        </div>
      );

    case "tool":
      if (item.auto && item.status !== "running") {
        // 取り消せる書き込み（自動実行済み）の結果カード。値はこの画面にだけ出し、Morrowには残さない
        return (
          <section
            className={`max-w-[560px] self-start rounded-xl border border-border border-l-4 bg-surface p-3 text-sm ${item.status === "failed" ? "border-l-red-600" : item.status === "unknown" ? "border-l-amber-500" : "border-l-accent"}`}
          >
            <div className="flex flex-wrap items-center gap-2 font-semibold">
              <span>{item.label}</span>
              <span
                className={`rounded-full px-2 py-px text-xs font-normal ${item.status === "failed" ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" : item.status === "unknown" ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300" : "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"}`}
              >
                {item.status === "failed" ? "失敗しました" : item.status === "unknown" ? "結果を確認できません" : "自動で実行しました"}
              </span>
            </div>
            {item.status === "unknown" && (
              <p className="mt-1.5 text-xs text-muted">
                途中で止まったため、実行されたか分かりません。予定・タスクの画面で確かめてから、無ければ改めて頼んでください（確かめずに頼み直すと重複することがあります）。
              </p>
            )}
            {item.status === "failed" && item.result?.failure && (
              <p className="mt-1.5 text-xs text-red-700 dark:text-red-300">理由: {item.result.failure}。実行されていない可能性が高いです。</p>
            )}
            {item.status === "done" && item.result?.url && (
              <p className="mt-1.5 text-xs">
                <a href={item.result.url} target="_blank" rel="noopener noreferrer" className="text-accent underline">
                  {item.result.number ? `#${item.result.number} を開く` : "作成したものを開く"}
                </a>
              </p>
            )}
            {item.lines.length > 0 && (
              <dl className="mt-1.5 grid grid-cols-[6em_1fr] gap-x-2.5 gap-y-0.5">
                {item.lines.map((line) => (
                  <div key={line.label} className="contents">
                    <dt className="text-xs text-muted">{line.label}</dt>
                    <dd className="break-all">{line.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        );
      }
      return (
        <div
          className={`inline-flex max-w-full items-center gap-1 self-start rounded-full border px-2.5 py-0.5 text-xs ${item.status === "running" ? "border-amber-400 text-amber-800 dark:text-amber-300" : item.status === "failed" ? "border-red-400 text-red-700" : item.status === "unknown" ? "border-amber-400 text-amber-800 dark:text-amber-300" : "border-border text-muted"}`}
        >
          {item.status === "running" ? (
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          ) : item.status === "failed" || item.status === "unknown" ? (
            <CircleAlert className="size-3" aria-hidden="true" />
          ) : (
            <Check className="size-3" aria-hidden="true" />
          )}
          <span className="truncate">{item.status === "running" ? `${item.label}…` : item.status === "unknown" ? `${item.label}（結果不明）` : item.label}</span>
          {item.hint && <span className="min-w-0 truncate text-muted/70">{item.hint}</span>}
          {item.status === "running" && item.startedAt ? (
            <span className="shrink-0 tabular-nums">{elapsedText(now - item.startedAt)}</span>
          ) : typeof item.durationSeconds === "number" && item.durationSeconds >= 1 ? (
            <span className="shrink-0 tabular-nums text-muted/70">{Math.round(item.durationSeconds)}秒</span>
          ) : null}
        </div>
      );

    case "proposal":
      return <ProposalCard proposal={item.proposal} onChange={onProposalChange} />;

    case "approval":
      return <ApprovalCard item={item} turnId={turnId} onApproval={onApproval} />;

    case "clarify":
      if (!item.requestId || item.questions.length === 0) {
        // 古いブリッジ（答える口が無い）から来た質問は、質問文だけを出す
        return (
          <div className="max-w-[88%] self-start whitespace-pre-wrap break-words rounded-2xl rounded-bl-sm border border-border bg-surface px-3.5 py-2 text-sm">
            <LinkedText text={item.text} />
          </div>
        );
      }
      return <ClarifyCard item={item} turnId={turnId} onClarify={onClarify} />;

    case "notice":
      return (
        <div className="flex flex-col items-center gap-1.5 self-center">
          <p
            role={item.tone === "error" ? "alert" : undefined}
            className={`text-center text-xs ${item.tone === "error" ? "text-red-700 dark:text-red-400" : "text-muted"}`}
          >
            {item.text}
          </p>
          {item.retry && onRetry && (
            <>
              {item.retry.risky && (
                <p className="max-w-[420px] text-center text-xs text-muted">
                  途中まで実行された可能性があります。予定・タスクなどの画面で結果を確かめてから、必要なら入力欄で送り直してください（確かめずに送ると重複することがあります）。
                </p>
              )}
              <button
                type="button"
                onClick={() => item.retry && onRetry(item.retry)}
                className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-foreground hover:bg-rail-active"
              >
                {item.retry.risky ? "指示を入力欄へ戻す" : "もう一度送る"}
              </button>
            </>
          )}
        </div>
      );

    case "usage":
      return <p className="self-start text-[11px] tabular-nums text-muted/70">{item.text}</p>;
  }
}

/** 経過のミリ秒を「N秒」「M分N秒」にする。 */
export function elapsedText(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60 ? `${seconds}秒` : `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
}

/** 質問などの素の文章。http(s)のURLだけ押せるリンクにする（#810）。HTMLは組み立てずReact要素で描く。 */
function LinkedText({ text }: { text: string }) {
  return (
    <>
      {splitLinks(text).map((part, index) =>
        part.type === "link" ? (
          <a
            key={index}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-accent underline underline-offset-2"
          >
            {part.text}
          </a>
        ) : (
          part.text
        ),
      )}
    </>
  );
}

/** Hermes自身の承認（通常は来ない）。出すのは「1回だけ許可」と「拒否」だけで、「常に許可」は出さない。 */
function ApprovalCard({
  item,
  turnId,
  onApproval,
}: {
  item: Extract<ChatItem, { kind: "approval" }>;
  turnId: string | null;
  onApproval: (requestId: string, choice: "once" | "deny") => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function answer(choice: "once" | "deny") {
    if (!turnId) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/hermes/turns/${encodeURIComponent(turnId)}/approval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: item.requestId, choice }),
      });
      if (response.ok) onApproval(item.requestId, choice);
      else setError(((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? "回答できませんでした。");
    } catch {
      setError("通信できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="max-w-[560px] self-start rounded-xl border border-border border-l-4 border-l-amber-500 bg-surface p-3.5 text-sm">
      <div className="flex flex-wrap items-center gap-2 font-semibold">
        <span>Hermesが許可を求めています</span>
        {item.status !== "waiting" && (
          <span className="rounded-full bg-border px-2 py-px text-xs font-normal text-muted">
            {item.status === "once" ? "許可しました（1回だけ）" : "拒否しました"}
          </span>
        )}
      </div>
      {item.description && <p className="mt-1 text-xs text-muted">{item.description}</p>}
      {item.command && <pre className="mt-2 overflow-x-auto rounded-lg bg-background px-2.5 py-2 text-xs">{item.command}</pre>}
      {error && (
        <p className="mt-2 text-xs text-red-700" role="alert">
          {error}
        </p>
      )}
      {item.status === "waiting" && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button type="button" disabled={busy || !turnId} onClick={() => answer("once")} className="rounded-lg bg-accent px-4 py-2 text-white disabled:opacity-45">
            1回だけ許可
          </button>
          <button type="button" disabled={busy || !turnId} onClick={() => answer("deny")} className="rounded-lg border border-border px-4 py-2 disabled:opacity-45">
            拒否
          </button>
        </div>
      )}
    </section>
  );
}

/** 回答を、画面に出す1行にする（答えた後のカード用）。 */
function answerLabel(question: ClarifyQuestion, answer: ClarifyAnswer | undefined): string {
  if (answer === undefined || answer === null || (Array.isArray(answer) && answer.length === 0)) return "（スキップ）";
  return Array.isArray(answer) ? answer.join("、") : answer;
}

/**
 * Hermesの選択肢つきの質問（#1150）。承認カードと同じ作り。1問・1つ選ぶ形なら、選択肢を押した時点で答える。
 * それ以外（複数の質問・複数選択・自由入力）は選んでから「答える」。「スキップ」は全問を答えずに返す。
 */
function ClarifyCard({
  item,
  turnId,
  onClarify,
}: {
  item: Extract<ChatItem, { kind: "clarify" }>;
  turnId: string | null;
  onClarify: (requestId: string, answers: Record<string, ClarifyAnswer>) => void;
}) {
  const [draft, setDraft] = useState<Record<string, ClarifyAnswer>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = item.requestId ?? "";
  const single = item.questions.length === 1 && item.questions[0].choices !== null && !item.questions[0].multiSelect;
  const waiting = item.status === "waiting";

  async function send(answers: Record<string, ClarifyAnswer>) {
    if (!turnId || !requestId) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/hermes/turns/${encodeURIComponent(turnId)}/clarify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, answers }),
      });
      if (response.ok) onClarify(requestId, answers);
      else setError(((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? "回答できませんでした。");
    } catch {
      setError("通信できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  function toggle(question: ClarifyQuestion, choice: string) {
    setDraft((current) => {
      if (!question.multiSelect) return { ...current, [question.qid]: choice };
      const picked = Array.isArray(current[question.qid]) ? (current[question.qid] as string[]) : [];
      const next = picked.includes(choice) ? picked.filter((c) => c !== choice) : [...picked, choice];
      return { ...current, [question.qid]: next };
    });
  }

  /** 送る値。自由入力は前後の空白を落とし、空ならスキップにする。 */
  function collected(): Record<string, ClarifyAnswer> {
    const out: Record<string, ClarifyAnswer> = {};
    for (const q of item.questions) {
      const value = draft[q.qid];
      if (typeof value === "string" && q.choices === null) out[q.qid] = value.trim() === "" ? null : value.trim();
      else if (Array.isArray(value)) out[q.qid] = value.length > 0 ? value : null;
      else out[q.qid] = value ?? null;
    }
    return out;
  }

  const disabled = busy || !turnId || !waiting;

  return (
    <section className="max-w-[560px] self-start rounded-xl border border-border border-l-4 border-l-accent bg-surface p-3.5 text-sm">
      <div className="flex flex-wrap items-center gap-2 font-semibold">
        <span>Hermesが確認しています</span>
        {item.status !== "waiting" && (
          <span className="rounded-full bg-border px-2 py-px text-xs font-normal text-muted">
            {item.status === "answered" ? "答えました" : "期限切れ（答えられません）"}
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-col gap-3">
        {item.questions.map((question) => (
          <fieldset key={question.qid} className="flex flex-col gap-1.5">
            <legend className="whitespace-pre-wrap break-words">
              <LinkedText text={question.question} />
            </legend>
            {item.status === "answered" ? (
              <p className="text-xs text-muted">→ {answerLabel(question, item.answers?.[question.qid])}</p>
            ) : question.choices ? (
              <div className="flex flex-wrap gap-1.5">
                {question.multiSelect && <span className="w-full text-xs text-muted">いくつでも選べます</span>}
                {question.choices.map((choice) => {
                  const value = draft[question.qid];
                  const selected = Array.isArray(value) ? value.includes(choice) : value === choice;
                  return (
                    <button
                      key={choice}
                      type="button"
                      disabled={disabled}
                      aria-pressed={selected}
                      onClick={() => (single ? void send({ [question.qid]: choice }) : toggle(question, choice))}
                      className={`rounded-lg border px-3 py-1.5 text-left disabled:opacity-45 ${selected ? "border-accent bg-accent/10 text-foreground" : "border-border bg-background hover:bg-rail-active"}`}
                    >
                      {question.multiSelect && <span aria-hidden="true">{selected ? "☑ " : "☐ "}</span>}
                      {choice}
                    </button>
                  );
                })}
              </div>
            ) : (
              <textarea
                rows={2}
                maxLength={1000}
                disabled={disabled}
                value={typeof draft[question.qid] === "string" ? (draft[question.qid] as string) : ""}
                onChange={(event) => setDraft((current) => ({ ...current, [question.qid]: event.target.value }))}
                className="w-full resize-y rounded-lg border border-border bg-background px-2.5 py-1.5 text-base disabled:opacity-45"
                placeholder="答えを入力"
              />
            )}
          </fieldset>
        ))}
      </div>
      {error && (
        <p className="mt-2 text-xs text-red-700" role="alert">
          {error}
        </p>
      )}
      {waiting && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {!single && (
            <button type="button" disabled={disabled} onClick={() => void send(collected())} className="rounded-lg bg-accent px-4 py-2 text-white disabled:opacity-45">
              答える
            </button>
          )}
          <button
            type="button"
            disabled={disabled}
            onClick={() => void send(Object.fromEntries(item.questions.map((q) => [q.qid, null])))}
            className="rounded-lg border border-border px-4 py-2 disabled:opacity-45"
          >
            スキップ
          </button>
        </div>
      )}
      {item.status === "closed" && <p className="mt-2 text-xs text-muted">答える時間（5分）を過ぎたか、会話が止まりました。続きは入力欄から伝えてください。</p>}
    </section>
  );
}
