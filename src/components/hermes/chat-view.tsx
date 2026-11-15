"use client";

import { Plus, SendHorizontal, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ChatItemView } from "@/components/hermes/chat-items";
import { ProposalCard } from "@/components/hermes/proposal-card";
import { describeHermesError, type ChatConnection } from "@/lib/hermes/errors";
import { readTurnIdHeader } from "@/lib/hermes/turn-header";
import type { HermesErrorKind } from "@/lib/hermes/client-core";
import type { ProposalView } from "@/lib/hermes/proposal-core";
import { nextRestoreDelay, shouldRetryRestore } from "@/lib/hermes/restore-retry";
import {
  browserStorage,
  clearChatSnapshot,
  clearActiveTurn,
  clearSessionId,
  loadChatSnapshot,
  loadSessionId,
  saveActiveTurn,
  saveChatSnapshot,
  saveSessionId,
  peekActiveTurn,
} from "@/lib/hermes/session-memory";
import { readSseEvents } from "@/lib/hermes/sse";
import { mentionsWeather } from "@/lib/weather/chat-context-core";
import {
  addNotice,
  answerApproval,
  applyEvent,
  endTurn,
  initialChatState,
  RELAY_EVENT_TYPES,
  restoreFromHistory,
  startTurn,
  updateProposal,
  type ChatState,
  type RelayEvent,
} from "@/lib/hermes/stream-view";

/**
 * チャット画面（#794）。Hermes Agentへ指示し、返答・道具の実行・確認カードを見る。
 *
 * 会話の本文はMorrowのサーバーに残さない。端末にはセッションidだけを覚え（#929。`session-memory.ts`）、開いたときに
 * Hermesの履歴（#752）から前回の発言を取り直す。「新しい会話」で記憶を消す。
 * **画面を閉じるとMorrowとの接続が切れて実行は中断される**（#726）。確認待ちは保存されているので、開き直せば承認できる。
 */

type Props = {
  /** 記憶したセッションidを利用者と結ぶ鍵（別の利用者のidを読まない）。 */
  userId: string;
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

/** 現在地を1回だけ取る（追跡しない。8秒で諦める）。拒否・失敗・非対応はnull（サーバーが自宅の天気で代える）。 */
function currentLocation(): Promise<{ latitude: number; longitude: number } | null> {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60_000 },
    );
  });
}

/** 待つ。中断されたら待ちを打ち切る。 */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/** 画面が表に出ていて回線もあるまで待つ（裏にいる間のiOSは通信を切るので、戻るのを待ってから続きを取る。#1000）。 */
function whenReady(signal: AbortSignal): Promise<void> {
  const ready = () => document.visibilityState !== "hidden" && navigator.onLine !== false;
  if (ready()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      if (!ready() && !signal.aborted) return;
      document.removeEventListener("visibilitychange", done);
      window.removeEventListener("online", done);
      resolve();
    };
    document.addEventListener("visibilitychange", done);
    window.addEventListener("online", done);
    signal.addEventListener("abort", done, { once: true });
  });
}

/** 続きの受け直しの間隔（ミリ秒）。尽きたら諦める。 */
const RESUME_DELAYS = [500, 1500, 3000, 6000, 10_000];

/** 画面遷移で戻ったときの控え（#976）。端末に覚えたセッションと同じ会話のときだけ使う。 */
function snapshotFor(userId: string): ChatState | null {
  const snapshot = loadChatSnapshot(userId);
  if (!snapshot) return null;
  return snapshot.sessionId && snapshot.sessionId === loadSessionId(browserStorage(), userId) ? snapshot : null;
}

export function ChatView({ userId, initialPending }: Props) {
  // 控えがあれば取り直さず即表示する。画面を離れるとこのコンポーネントは捨てられるため、戻るたびの履歴取得を避ける
  const [{ snapshot, resumeFrom }] = useState(() => {
    const saved = snapshotFor(userId);
    // 実行中のまま離れた会話は、続きを受け直せるときだけ実行中として開く（#1000）。受け直せなければ終わった扱い
    const active = saved?.running ? peekActiveTurn(userId, saved) : null;
    return { snapshot: saved && saved.running && !active ? endTurn(saved) : saved, resumeFrom: active };
  });
  const [chat, setChat] = useState<ChatState>(snapshot ?? initialChatState);
  const chatRef = useRef(chat);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [connection, setConnection] = useState<ChatConnection>("unknown");
  const [pending, setPending] = useState(initialPending);
  const [restoring, setRestoring] = useState(() => snapshot === null && loadSessionId(browserStorage(), userId) !== null);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [resumed, setResumed] = useState(snapshot !== null);
  const abortRef = useRef<AbortController | null>(null);
  const turnRef = useRef<string | null>(null);
  // サーバーから受けたイベントの数と、ターンが終わったか（#1000。切れたあと続きから受け直す位置）
  const receivedRef = useRef(0);
  const endedRef = useRef(false);
  // 前回の会話の復元の中断口。復元中に「新しい会話」を選んだとき、遅れて届いた旧履歴で画面を上書きさせない（#936）
  const restoreAbortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const busy = sending || chat.running;
  const sendBlocked = busy || restoring;

  useEffect(() => {
    turnRef.current = chat.turnId;
  }, [chat.turnId]);

  useEffect(() => {
    chatRef.current = chat;
  }, [chat]);

  const retryStatus = useCallback(() => {
    setConnection("unknown");
    void fetchStatus().then(setConnection);
  }, []);

  useEffect(() => {
    let active = true;
    void fetchStatus().then((state) => {
      if (active) setConnection(state);
    });
    // 別アプリから戻った・回線が戻ったときは、接続状態を取り直す（#930。裏にいる間に通信が切られて「届きません」のまま残るため）
    const recheck = () => {
      if (document.visibilityState === "hidden") return;
      void fetchStatus().then((state) => {
        if (active) setConnection(state);
      });
    };
    document.addEventListener("visibilitychange", recheck);
    window.addEventListener("online", recheck);
    // 画面を離れたらターンの接続を閉じる（ブリッジは切断で中断する）
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", recheck);
      window.removeEventListener("online", recheck);
      abortRef.current?.abort();
    };
  }, []);

  // 前回の会話を取り直す（#929）。通信の揺れで落ちた回はやり直し（#976）、尽きたら読み直しボタンを出す
  const restore = useCallback(
    async (remembered: string, controller: AbortController) => {
      const storage = browserStorage();
      try {
        for (let attempt = 0; ; attempt += 1) {
          let kind: string | null = null;
          try {
            const response = await fetch(`/api/hermes/sessions/${encodeURIComponent(remembered)}/messages`, {
              cache: "no-store",
              signal: controller.signal,
            });
            const data = (await response.json().catch(() => null)) as {
              messages?: { role: "user" | "assistant"; text: string }[];
              kind?: string;
            } | null;
            if (controller.signal.aborted) return;
            if (response.ok && Array.isArray(data?.messages)) {
              const messages = data.messages;
              setChat((s) => (s.items.length === 0 && s.sessionId === null ? restoreFromHistory(s, remembered, messages) : s));
              setResumed(messages.some((m) => m.text.trim() !== ""));
              return;
            }
            kind = data?.kind ?? (response.status >= 500 ? "server_error" : "failed");
            if (kind === "no_session") {
              clearSessionId(storage);
              return;
            }
          } catch {
            if (controller.signal.aborted) return;
          }
          const delay = shouldRetryRestore(kind) ? nextRestoreDelay(attempt) : null;
          if (delay === null) {
            setRestoreFailed(true);
            return;
          }
          // 再試行を待つあいだは送信を止めない。新しい会話を始めたら、遅れて届いた履歴は上書きガードで捨てられる
          setRestoring(false);
          await sleep(delay, controller.signal);
          if (controller.signal.aborted) return;
        }
      } finally {
        if (!controller.signal.aborted) setRestoring(false);
      }
    },
    [],
  );

  const startRestore = useCallback(() => {
    const remembered = loadSessionId(browserStorage(), userId);
    restoreAbortRef.current?.abort();
    // 覚えたidが無いときは、読み込み中の表示を初期値の時点で出していない
    if (!remembered) return;
    const controller = new AbortController();
    restoreAbortRef.current = controller;
    void restore(remembered, controller);
  }, [restore, userId]);

  const retryRestore = useCallback(() => {
    setRestoreFailed(false);
    setRestoring(true);
    startRestore();
  }, [startRestore]);

  useEffect(() => {
    // 開いた直後の取り直し。画面の初期表示（読み込み中か）はuseStateの初期値で決めてある
    if (snapshot === null) startRestore();
    return () => {
      restoreAbortRef.current?.abort();
      restoreAbortRef.current = null;
    };
  }, [snapshot, startRestore]);

  // 取り直しが尽きたあと、アプリへ戻った・回線が戻ったときにもう一度試す（#976）
  useEffect(() => {
    if (!restoreFailed) return;
    const again = () => {
      if (document.visibilityState !== "hidden") retryRestore();
    };
    document.addEventListener("visibilitychange", again);
    window.addEventListener("online", again);
    return () => {
      document.removeEventListener("visibilitychange", again);
      window.removeEventListener("online", again);
    };
  }, [restoreFailed, retryRestore]);

  // 画面を離れるとき、会話をメモリへ控える（#976。保存はしない）
  useEffect(() => {
    return () => {
      const state = chatRef.current;
      // 実行中のターンはサーバーが続けている。戻ったら続きから受け直せるよう、位置を覚えておく（#1000）
      // turnId はヘッダーで先に受けた値（turnRef）も見る。最初のイベント前に離れても続きを受け直せる（#1005）
      const activeTurnId = state.turnId ?? turnRef.current;
      if (state.running && activeTurnId && !endedRef.current) {
        saveActiveTurn(userId, activeTurnId, receivedRef.current);
        saveChatSnapshot(userId, state, true);
      } else {
        clearActiveTurn();
        saveChatSnapshot(userId, state);
      }
    };
  }, [userId]);

  useEffect(() => {
    if (chat.sessionId) saveSessionId(browserStorage(), userId, chat.sessionId);
  }, [chat.sessionId, userId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [chat.items, chat.running]);

  // ターンのイベントを画面へ畳み込む。受けた数を数え、終わりのイベントを見たら印を立てる（#1000）
  const consume = useCallback(async (body: ReadableStream<Uint8Array>) => {
    for await (const event of readSseEvents<RelayEvent>(body, RELAY_EVENT_TYPES)) {
      receivedRef.current += 1;
      if (event.type === "turn") turnRef.current = event.data.turnId;
      if (event.type === "message.complete" || event.type === "error") endedRef.current = true;
      setChat((s) => {
        const next = applyEvent(s, event);
        chatRef.current = next;
        return next;
      });
    }
  }, []);

  // 通信が切れたターンの続きを、サーバーが溜めた位置から受け直す（#1000）。終わりまで受けられたらtrue。
  const resume = useCallback(
    async (controller: AbortController): Promise<boolean> => {
      for (let attempt = 0; attempt <= RESUME_DELAYS.length; attempt += 1) {
        await whenReady(controller.signal);
        if (controller.signal.aborted) return false;
        const turnId = turnRef.current;
        if (!turnId) return false;
        try {
          const response = await fetch(`/api/hermes/turns/${encodeURIComponent(turnId)}/events?after=${receivedRef.current}`, {
            cache: "no-store",
            signal: controller.signal,
          });
          // 溜めが無い（再起動・期限切れ）。続きは受けられない
          if (response.status === 404 || response.status === 410) return false;
          if (response.ok && response.body) {
            await consume(response.body);
            if (endedRef.current) return true;
          }
        } catch {
          if (controller.signal.aborted) return false;
        }
        const delay = RESUME_DELAYS[attempt];
        if (delay === undefined) return false;
        await sleep(delay, controller.signal);
      }
      return false;
    },
    [consume],
  );

  // 画面を離れている間も実行が続いていたターン（#1000）は、戻ったら続きから受け直す
  useEffect(() => {
    if (!resumeFrom) return;
    clearActiveTurn();
    const active = resumeFrom;
    const controller = new AbortController();
    abortRef.current = controller;
    receivedRef.current = active.received;
    turnRef.current = active.turnId;
    endedRef.current = false;
    void (async () => {
      const finished = await resume(controller);
      if (controller.signal.aborted) return;
      if (!finished) {
        setChat((s) =>
          addNotice(s, "error", "続きを受けられませんでした。途中まで実行された可能性があるので、結果を確認してから送り直してください。"),
        );
      }
      setChat((s) => (s.running ? endTurn(s) : s));
      if (abortRef.current === controller) abortRef.current = null;
    })();
    return () => controller.abort();
  }, [resumeFrom, resume]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (text === "" || sendBlocked) return;
    setSending(true);
    setInput("");
    const controller = new AbortController();
    abortRef.current = controller;
    let started = false;
    // 天気について聞くときは現在地を添える（#930。取れなければ送らず、サーバーが自宅の天気で答える）
    const location = mentionsWeather(text) ? await currentLocation() : null;
    try {
      const response = await fetch("/api/hermes/turns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, ...(chat.sessionId ? { sessionId: chat.sessionId } : {}), ...(location ? { location } : {}) }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        // 送れなかった指示は入力欄へ戻す（溜めて後で送ることはしない）
        const data = (await response.json().catch(() => null)) as { error?: string; kind?: string } | null;
        setInput(text);
        const kind = data?.kind;
        const failure = kind && kind !== "invalid" && kind !== "rate_limited" ? describeHermesError(kind as HermesErrorKind) : null;
        if (failure?.connection) setConnection(failure.connection);
        if (kind === "no_session") {
          clearSessionId(browserStorage());
          clearChatSnapshot();
          setChat((s) => ({ ...s, sessionId: null }));
        }
        setChat((s) => addNotice(s, "error", data?.error ?? "送れませんでした。もう一度試してください。"));
        return;
      }
      started = true;
      setConnection("ok");
      receivedRef.current = 0;
      endedRef.current = false;
      // ターンIDはヘッダーで本文より先に届く。最初のイベント前の「止める」でもinterruptを送れる（#1005）
      turnRef.current = readTurnIdHeader(response.headers);
      setChat((s) => startTurn(s, text));
      try {
        await consume(response.body);
      } catch {
        // 通信が切れた。下で続きを受け直す
      }
      // iOSで別アプリへ移ると通信が切られるが、サーバーはターンを続けている（#1000）。戻ったら続きから受け直す
      if (!endedRef.current && !controller.signal.aborted && !(await resume(controller)) && !controller.signal.aborted) {
        setChat((s) =>
          addNotice(
            s,
            "error",
            "アプリを離れるなどで接続が切れ、続きを受けられませんでした。途中まで実行された可能性があるので、結果を確認してから送り直してください。",
          ),
        );
        void fetchStatus().then(setConnection);
      }
    } catch {
      if (!controller.signal.aborted) {
        if (started) {
          // iOSで別アプリへ移ると通信が切られ、実行は途中で止まる（#930）。指示はHermesへ届いて書き込みが済んでいる場合があるので、
          // 入力は戻さない（再送すると二重に実行しうる）。結果を確かめてから送り直してもらう
          setChat((s) =>
            addNotice(
              s,
              "error",
              "アプリを離れるなどで接続が切れ、実行が途中で止まりました。途中まで実行された可能性があるので、結果を確認してから送り直してください。",
            ),
          );
          void fetchStatus().then(setConnection);
        } else {
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
  }, [input, sendBlocked, chat.sessionId, consume, resume]);

  const stop = useCallback(async () => {
    const controller = abortRef.current;
    const turnId = turnRef.current;
    if (!turnId) {
      // ターンの開始前（レスポンス前）。接続を閉じる。サーバーは、ターンが始まった時点で切れていればそのターンを止める（#1005）
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
    // 実行中のターンは、止める操作と同じく先にinterruptを送る（接続を閉じるだけではサーバーが続ける。#1005）
    const turnId = turnRef.current;
    if (turnId && !endedRef.current) {
      void fetch(`/api/hermes/turns/${encodeURIComponent(turnId)}/interrupt`, { method: "POST" }).catch(() => {});
    }
    abortRef.current?.abort();
    // 復元中なら取り消す（中断された復元は結果を反映しないので、読み込み中の表示もここで閉じる）
    restoreAbortRef.current?.abort();
    restoreAbortRef.current = null;
    setRestoring(false);
    setRestoreFailed(false);
    clearSessionId(browserStorage());
    clearChatSnapshot();
    setResumed(false);
    setChat(initialChatState);
  }, []);

  const onProposalChange = useCallback((proposal: ProposalView) => setChat((s) => updateProposal(s, proposal)), []);
  const onApproval = useCallback((requestId: string, choice: "once" | "deny") => setChat((s) => answerApproval(s, requestId, choice)), []);

  const unreachable = connection === "unreachable" || connection === "hermes_down";
  const empty = chat.items.length === 0 && pending.length === 0 && !restoring;

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

          {restoring && <p className="py-2 text-center text-xs text-muted">前回の会話を読み込んでいます…</p>}
          {restoreFailed && (
            <p role="status" className="flex items-center justify-center gap-2 py-2 text-center text-xs text-muted">
              前回の会話を読み込めませんでした。
              <button type="button" onClick={retryRestore} className="rounded-md border border-border bg-background px-2 py-0.5 text-foreground">
                読み込み直す
              </button>
            </p>
          )}
          {resumed && (
            <p className="self-center rounded-full bg-rail-active px-3 py-0.5 text-[11px] text-muted">前回の会話を再開しました</p>
          )}

          {chat.items.map((item) => (
            <ChatItemView key={item.id} item={item} turnId={chat.turnId} onApproval={onApproval} onProposalChange={onProposalChange} />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      <form
        className="mobile-tab-pad-form border-t border-border bg-surface px-3 pt-2.5 lg:px-7"
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
                if (!sendBlocked) void send();
              }
            }}
            className="max-h-40 min-h-[40px] flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-base"
          />
          <button
            type="submit"
            disabled={!busy && (restoring || input.trim() === "")}
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
