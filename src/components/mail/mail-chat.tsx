"use client";

import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { FlowRowList } from "@/components/mail/flow-group";
import type { FlowCards, FlowRow } from "@/components/mail/use-flow-cards";
import type { MailChatReply } from "@/lib/mail/chat-core";
import { orderChatExamples } from "@/lib/mail/chat-examples";
import { recommendedIndex } from "@/lib/mail/flow-group";

/**
 * メール本文への指示（#784）。「AIの分析」カードの末尾に置く。指示を送ると `POST /api/mail/flow/chat`（Codexは1回）が
 * 返事と、必要なら提案の行を返す。行は分析と同じハーフモーダルで値を確かめてから登録する（自動では登録しない）。
 *
 * - **やり取りはこの画面のstateだけ**（DB・サーバーに残さない。画面を離れると消える）。続きの文脈は毎回 `history` として送り直す
 * - 返事はモデルの出力なのでプレーンテキストで出す（HTMLとして描かない）
 * - 分析中は送らない（利用者ごとにCodexは同時1件。サーバーも `busy` で断る）。送れなかった指示は入力欄へ戻す
 * - 型だけをimportする（`chat-core.ts` の値は読み込まない）
 */

/** 入力の上限（サーバーの `CHAT_MESSAGE_LIMIT` と同じ）。 */
const INPUT_MAX = 500;

type Turn = { role: "user"; text: string } | { role: "assistant"; text: string; rowIds: string[] };

export function MailChat({ id, analyzing, flow }: { id: string; analyzing: boolean; flow: FlowCards }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const counter = useRef(0);

  async function send(text: string) {
    const message = text.trim();
    if (message === "" || sending || analyzing) return;
    const history = turns.map((turn) => ({ role: turn.role, text: turn.text }));
    setTurns((current) => [...current, { role: "user", text: message }]);
    setInput("");
    setError(null);
    setSending(true);
    const outcome = await requestChat(id, message, history);
    setSending(false);
    if (!outcome.ok) {
      // 送れなかった指示は溜めずに入力欄へ戻す
      setTurns((current) => current.slice(0, -1));
      setInput(message);
      setError(outcome.error);
      return;
    }
    const { reply, suggest } = outcome.value;
    const prefix = `c${counter.current++}-`;
    const rows: Record<string, FlowRow> = {};
    // 同じ種類が複数あれば、おすすめの印は先頭の1行だけ（#1051）
    const pick = recommendedIndex(suggest.suggestions, suggest.recommended, true);
    suggest.suggestions.forEach((card, index) => (rows[`${prefix}${index}`] = { card, recommended: index === pick }));
    flow.replace(prefix, rows);
    setTurns((current) => [...current, { role: "assistant", text: reply, rowIds: Object.keys(rows) }]);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void send(input);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Ctrl/⌘+Enterで送る（Enterだけは改行。変換中は何もしない）
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send(input);
    }
  }

  async function copy(index: number, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(index);
      setTimeout(() => setCopied((current) => (current === index ? null : current)), 2000);
    } catch {
      setError("コピーできませんでした。長押しで選んでコピーしてください。");
    }
  }

  const blocked = analyzing || sending;
  // 分析の提案（`a-` の行。指示の行は `c` 始まり）の種類に合う候補を先頭へ
  const examples = orderChatExamples(
    Object.entries(flow.rows)
      .filter(([rowId]) => !rowId.startsWith("c"))
      .map(([, row]) => row.card.kind),
  );

  return (
    <div className="border-t border-border pt-2">
      <p className="mb-1.5 text-[0.6875rem] text-muted">💬 このメールについて頼む</p>

      {turns.length > 0 && (
        <ol aria-label="このメールへの指示のやり取り" aria-live="polite" className="mb-2 flex flex-col gap-1.5">
          {turns.map((turn, index) =>
            turn.role === "user" ? (
              <li key={index} className="max-w-[85%] self-end whitespace-pre-wrap break-words rounded-xl bg-accent-surface px-3 py-2">
                {turn.text}
              </li>
            ) : (
              <li key={index} className="flex max-w-[85%] flex-col gap-1.5 self-start rounded-xl border border-border bg-background px-3 py-2">
                <p className="whitespace-pre-wrap break-words">{turn.text}</p>
                {turn.rowIds.length > 0 && <FlowRowList rowIds={turn.rowIds} flow={flow} />}
                <button type="button" onClick={() => void copy(index, turn.text)} className="self-end text-[0.6875rem] text-muted hover:text-foreground">
                  {copied === index ? "コピーしました" : "文をコピー"}
                </button>
              </li>
            ),
          )}
          {sending && (
            <li className="self-start rounded-xl border border-border bg-background px-3 py-2 text-muted">考えています…（30秒ほどかかることがあります）</li>
          )}
        </ol>
      )}

      {error && (
        <p role="alert" className="mb-2 rounded-[10px] border border-danger/30 bg-danger-surface px-3 py-2 text-danger">
          {error}
        </p>
      )}

      {turns.length === 0 && (
        // 折り返さず1行の横スクロール。右端をフェードさせて続きがあることを示す（#1138）
        <div
          aria-label="頼み方の候補"
          className="mb-2 flex gap-1.5 overflow-x-auto overscroll-x-contain pb-1 [-webkit-mask-image:linear-gradient(90deg,#000_calc(100%-1.75rem),transparent)] [mask-image:linear-gradient(90deg,#000_calc(100%-1.75rem),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {examples.map((example) => (
            <button
              key={example}
              type="button"
              disabled={blocked}
              onClick={() => void send(example)}
              className="shrink-0 whitespace-nowrap rounded-full border border-border bg-background px-2.5 py-1 text-[0.6875rem] transition-colors hover:bg-rail-active disabled:opacity-50"
            >
              {example}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={submit} className="flex items-end gap-1.5">
        <label className="sr-only" htmlFor={`mail-chat-${id}`}>
          このメールについて頼みたいこと
        </label>
        <textarea
          id={`mail-chat-${id}`}
          rows={1}
          maxLength={INPUT_MAX}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={analyzing ? "分析が終わってから送れます" : "頼みたいことを書く…"}
          // 入力文字は16px（iOSの自動拡大を避ける下限。globals.css）のまま、プレースホルダーだけ小さくする（#1138）
          className="field-sizing-content max-h-40 min-h-9 flex-1 resize-none rounded-[10px] border border-border bg-background px-2.5 py-2 text-sm placeholder:text-xs"
        />
        <button
          type="submit"
          disabled={blocked || input.trim() === ""}
          className="shrink-0 rounded-[10px] bg-accent px-3.5 py-2 text-xs font-bold text-accent-foreground disabled:opacity-50"
        >
          送る
        </button>
      </form>
      <p className="mt-1.5 text-[0.6875rem] text-muted">やり取りは保存されません。登録は行を確かめてから行います。</p>
    </div>
  );
}

type ChatResponse = { ok: true; value: MailChatReply } | { ok: false; error: string };

async function requestChat(id: string, message: string, history: { role: string; text: string }[]): Promise<ChatResponse> {
  try {
    const response = await fetch("/api/mail/flow/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, message, history }),
    });
    const data = (await response.json().catch(() => null)) as (MailChatReply & { error?: string }) | null;
    if (!response.ok || typeof data?.reply !== "string" || !data.suggest) {
      return { ok: false, error: data?.error ?? `返事を作れませんでした（HTTP ${response.status}）。` };
    }
    return { ok: true, value: { reply: data.reply, suggest: data.suggest } };
  } catch {
    return { ok: false, error: "返事を作れませんでした（通信できませんでした）。" };
  }
}
