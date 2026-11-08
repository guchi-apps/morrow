"use client";

import { Plus, SendHorizontal, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ChatItemView } from "@/components/hermes/chat-items";
import { ProposalCard } from "@/components/hermes/proposal-card";
import { describeHermesError, type ChatConnection } from "@/lib/hermes/errors";
import type { HermesErrorKind } from "@/lib/hermes/client-core";
import type { ProposalView } from "@/lib/hermes/proposal-core";
import { readSseEvents } from "@/lib/hermes/sse";
import {
  addNotice,
  answerApproval,
  applyEvent,
  endTurn,
  initialChatState,
  RELAY_EVENT_TYPES,
  startTurn,
  updateProposal,
  type ChatState,
  type RelayEvent,
} from "@/lib/hermes/stream-view";

/**
 * チャット画面（#794）。Hermes Agentへ指示し、返答・道具の実行・確認カードを見る。
 *
 * 会話の本文はこの画面のstateにだけ持つ（Morrowのサーバーには残さない。リロードで新しい会話。過去の表示は #752）。
 * **画面を閉じるとMorrowとの接続が切れて実行は中断される**（#726）。確認待ちは保存されているので、開き直せば承認できる。
 */

type Props = {
  /** 前の会話から残っている確認待ち（開いた時点でDBにあるもの）。 */
  initialPending: ProposalView[];
};

const STATUS_TEXT: Record<ChatConnection, string> = {
  unknown: "接続を確認しています…",
  ok: "接続中（Hermes）",
  unreachable: "Hermesに届きません（サブPCが止まっている可能性があります）",
  hermes_down: "Hermesが応答しません",
  misconfigured: "接続の設定に問題があります",
};

async function fetchStatus(): Promise<ChatConnection> {
  try {
    const response = await fetch("/api/hermes/status", { cache: "no-store" });
    const data = (await response.json().catch(() => null)) as { state?: ChatConnection } | null;
    return response.ok && data?.state ? data.state : "unreachable";
  } catch {
    return "unreachable";
  }
}

export function ChatView({ initialPending }: Props) {
  const [chat, setChat] = useState<ChatState>(initialChatState);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [connection, setConnection] = useState<ChatConnection>("unknown");
  const [pending, setPending] = useState(initialPending);
  const abortRef = useRef<AbortController | null>(null);
  const turnRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const busy = sending || chat.running;

  useEffect(() => {
    turnRef.current = chat.turnId;
  }, [chat.turnId]);

  const retryStatus = useCallback(() => {
    setConnection("unknown");
    void fetchStatus().then(setConnection);
  }, []);

  useEffect(() => {
    let active = true;
    void fetchStatus().then((state) => {
      if (active) setConnection(state);
    });
    // 画面を離れたらターンの接続を閉じる（ブリッジは切断で中断する）
    return () => {
      active = false;
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [chat.items, chat.running]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (text === "" || busy) return;
    setSending(true);
    setInput("");
    const controller = new AbortController();
    abortRef.current = controller;
    let started = false;
    try {
      const response = await fetch("/api/hermes/turns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, ...(chat.sessionId ? { sessionId: chat.sessionId } : {}) }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        // 送れなかった指示は入力欄へ戻す（溜めて後で送ることはしない）
        const data = (await response.json().catch(() => null)) as { error?: string; kind?: string } | null;
        setInput(text);
        const kind = data?.kind;
        const failure = kind && kind !== "invalid" && kind !== "rate_limited" ? describeHermesError(kind as HermesErrorKind) : null;
        if (failure?.connection) setConnection(failure.connection);
        if (kind === "no_session") setChat((s) => ({ ...s, sessionId: null }));
        setChat((s) => addNotice(s, "error", data?.error ?? "送れませんでした。もう一度試してください。"));
        return;
      }
      started = true;
      setConnection("ok");
      setChat((s) => startTurn(s, text));
      for await (const event of readSseEvents<RelayEvent>(response.body, RELAY_EVENT_TYPES)) {
        setChat((s) => applyEvent(s, event));
      }
    } catch {
      if (!controller.signal.aborted) {
        if (started) setChat((s) => addNotice(s, "error", "Hermesとの接続が切れました。実行の途中までで止まっています。"));
        else {
          setInput(text);
          setConnection("unreachable");
          setChat((s) => addNotice(s, "error", "Morrowに接続できませんでした。もう一度試してください。"));
        }
      }
    } finally {
      setChat((s) => (s.running ? endTurn(s) : s));
      setSending(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [input, busy, chat.sessionId]);

  const stop = useCallback(async () => {
    const controller = abortRef.current;
    const turnId = turnRef.current;
    if (!turnId) {
      // ターンの開始前。接続そのものを閉じる
      controller?.abort();
      return;
    }
    try {
      await fetch(`/api/hermes/turns/${encodeURIComponent(turnId)}/interrupt`, { method: "POST" });
    } catch {
      // 届かなければ下の切断で止める
    }
    // 中断の応答が来なくても止める（接続を閉じるとブリッジも中断する）
    window.setTimeout(() => {
      if (abortRef.current === controller) controller?.abort();
    }, 8000);
  }, []);

  const newConversation = useCallback(() => {
    abortRef.current?.abort();
    setChat(initialChatState);
  }, []);

  const onProposalChange = useCallback((proposal: ProposalView) => setChat((s) => updateProposal(s, proposal)), []);
  const onApproval = useCallback((requestId: string, choice: "once" | "deny") => setChat((s) => answerApproval(s, requestId, choice)), []);

  const unreachable = connection === "unreachable" || connection === "hermes_down";
  const empty = chat.items.length === 0 && pending.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className={`flex items-center justify-between gap-2 border-b border-border px-4 py-1.5 text-xs lg:px-7 ${
          connection === "ok"
            ? "bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-200"
            : connection === "misconfigured"
              ? "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300"
              : unreachable
                ? "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                : "text-muted"
        }`}
      >
        <span role={connection === "ok" || connection === "unknown" ? undefined : "status"}>● {STATUS_TEXT[connection]}</span>
        <span className="flex items-center gap-2">
          {unreachable || connection === "misconfigured" ? (
            <button type="button" onClick={retryStatus} className="rounded-md border border-current px-2 py-0.5">
              再試行
            </button>
          ) : null}
          <button
            type="button"
            onClick={newConversation}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-foreground hover:bg-rail-active"
          >
            <Plus className="size-3" aria-hidden="true" />
            新しい会話
          </button>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 lg:px-7">
        <div className="mx-auto flex max-w-[760px] flex-col gap-2.5">
          {pending.length > 0 && (
            <section className="flex flex-col gap-2" aria-label="前の会話から残っている確認待ち">
              <h2 className="text-xs font-medium text-muted">確認待ち（前の会話から）</h2>
              {pending.map((proposal) => (
                <ProposalCard
                  key={proposal.id}
                  proposal={proposal}
                  onChange={(next) => setPending((list) => list.map((p) => (p.id === next.id ? next : p)))}
                />
              ))}
            </section>
          )}

          {empty && (
            <p className="py-10 text-center text-sm text-muted">
              Hermesに指示を書いてみましょう。予定やタスクの確認・登録、天気、家計の確認などを頼めます。
            </p>
          )}

          {chat.items.map((item) => (
            <ChatItemView key={item.id} item={item} turnId={chat.turnId} onApproval={onApproval} onProposalChange={onProposalChange} />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      <form
        className="border-t border-border bg-surface px-3 py-2.5 lg:px-7"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) void stop();
          else void send();
        }}
      >
        <div className="mx-auto flex max-w-[760px] items-end gap-2">
          <textarea
            aria-label="Hermesへの指示"
            value={input}
            rows={1}
            maxLength={4000}
            placeholder="指示を入力…"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                if (!busy) void send();
              }
            }}
            className="max-h-40 min-h-[40px] flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-base"
          />
          <button
            type="submit"
            disabled={!busy && input.trim() === ""}
            className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-4 text-sm text-white disabled:opacity-45 ${busy ? "bg-red-600" : "bg-accent"}`}
          >
            {busy ? <Square className="size-3.5" aria-hidden="true" /> : <SendHorizontal className="size-3.5" aria-hidden="true" />}
            {busy ? "止める" : "送信"}
          </button>
        </div>
      </form>
    </div>
  );
}
