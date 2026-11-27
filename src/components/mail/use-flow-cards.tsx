"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { FlowSheet, type CardResult } from "@/components/mail/flow-sheet";
import type { CalendarChoice } from "@/lib/mail/link-core";
import type { TrackingTaskTarget } from "@/components/mail/tracking-task-section";
import { linkAppUrl, taskOpenUrl } from "@/lib/mail/app-links";
import { receiptUrl } from "@/lib/mail/payment-receipt";
import type { Suggestion } from "@/lib/mail/suggest-core";
import { matchQueryOf, type SubscriptionMatch } from "@/lib/mail/subscription-match-core";
import type { TrackingFields } from "@/lib/mail/tracking-link";
import { isAttachableTracking } from "@/lib/mail/tracking-task";

/**
 * 提案の行（分析 #766・指示 #784）の状態と、押したときのハーフモーダル（`FlowSheet`）。1通のメールの画面に1つ。
 *
 * **状態は行ごとの識別子をキーに持つ**（#784の計画レビュー）。以前は種類（payment など）をキーにしていたため、
 * 分析と指示の返事に同じ種類の行が出ると、登録結果・実行中・開いている行が互いに上書きされた。
 * 識別子は呼び出し側が付ける（分析は `a-<n>`、指示は `c<返事の番号>-<n>`）。二重登録は `/apply` の冪等キー・`gmailMessageId` が止める。
 */

export type FlowRow = { card: Suggestion; recommended: boolean; /** タスクのメモに追跡番号を入れない（#1211。既定は入れる）。 */ skipTracking?: boolean };

/** 同じ返答（分析・指示の返事1件）の追跡の提案のうち、タスクのメモに入れられる番号（#1211）。 */
function attachableTracking(rows: Record<string, FlowRow>, rowId: string): TrackingFields | null {
  const prefix = rowId.slice(0, rowId.indexOf("-") + 1);
  for (const [id, { card }] of Object.entries(rows)) {
    if (id.startsWith(prefix) && card.kind === "tracking" && isAttachableTracking(card.fields)) return { carrier: card.fields.carrier, number: card.fields.number };
  }
  return null;
}

export function useFlowCards(mailId: string) {
  const router = useRouter();
  const [rows, setRows] = useState<Record<string, FlowRow>>({});
  const [outcomes, setOutcomes] = useState<Record<string, CardResult>>({});
  const [running, setRunning] = useState<string | null>(null);
  /** まとめて登録（#1051）の実行中。行ごとの登録・別のまとめて登録を止める。 */
  const [bulkRunning, setBulkRunning] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  /** サブスク提案のAsset Managerとの照合（#884）。行の識別子→結果。取得中・未取得はキーが無い。 */
  const [matches, setMatches] = useState<Record<string, SubscriptionMatch>>({});
  const asked = useRef(new Set<string>());
  /** 予定の保存先の候補（#908）。予定の行を開いたときに1回だけ取る。null は未取得・取得できなかった（既定の保存先だけで続ける）。 */
  const [calendars, setCalendars] = useState<CalendarChoice[] | null>(null);
  const calendarsAsked = useRef(false);
  const openKind = open ? rows[open]?.card.kind : undefined;

  useEffect(() => {
    if (openKind !== "event" || calendarsAsked.current) return;
    calendarsAsked.current = true;
    fetch("/api/mail/flow/calendars")
      .then((response) => (response.ok ? (response.json() as Promise<{ ok: boolean; calendars?: CalendarChoice[] }>) : null))
      .then((data) => {
        if (data?.ok && Array.isArray(data.calendars)) setCalendars(data.calendars);
      })
      .catch(() => {});
  }, [openKind]);

  /** 照合を取りに行く（#884・#896）。手動の紐づけ（#1130）をサーバーが優先するので、メールIDと種類も送る。 */
  const fetchMatch = useCallback(
    (rowId: string, card: Suggestion, query: NonNullable<ReturnType<typeof matchQueryOf>>) =>
      fetch("/api/mail/flow/subscription-match", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...query, id: mailId, kind: card.kind }),
      })
        .then((response) => (response.ok ? (response.json() as Promise<SubscriptionMatch>) : ({ status: "error" } as SubscriptionMatch)))
        .catch(() => ({ status: "error" }) as SubscriptionMatch)
        .then((result) => setMatches((current) => ({ ...current, [rowId]: result }))),
    [mailId],
  );

  useEffect(() => {
    for (const [rowId, { card }] of Object.entries(rows)) {
      // サブスクに加えて家計簿の提案も照合する（#896。定期払いの請求を「登録済み」と出す）
      const query = matchQueryOf(card);
      if (!query) continue;
      const key = `${rowId}:${JSON.stringify(query)}`;
      if (asked.current.has(key)) continue;
      asked.current.add(key);
      void fetchMatch(rowId, card, query);
    }
  }, [rows, fetchMatch]);

  /**
   * 定期払いの紐づけを手で変える（#1130）。`subscriptionId`: 数＝その定期払い、null＝紐づけなし、"auto"＝自動の判定へ戻す。
   * 保存できたら照合を取り直す。失敗は文言を返す（成功はnull）。
   */
  async function changeLink(rowId: string, subscriptionId: number | null | "auto"): Promise<string | null> {
    const card = rows[rowId]?.card;
    const query = card ? matchQueryOf(card) : null;
    if (!card || !query) return "紐づけ先を変えられませんでした。";
    try {
      const response = await fetch("/api/mail/flow/subscription-link", {
        method: subscriptionId === "auto" ? "DELETE" : "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(subscriptionId === "auto" ? { id: mailId, kind: card.kind } : { id: mailId, kind: card.kind, subscriptionId }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        return data?.error ?? "紐づけ先を変えられませんでした。";
      }
    } catch {
      return "通信できませんでした。";
    }
    await fetchMatch(rowId, card, query);
    return null;
  }

  /** `prefix` で始まる行を消して入れ直す（分析し直したとき）。結果の表示も消す。 */
  const replace = useCallback((prefix: string, next: Record<string, FlowRow>) => {
    const keep = <T,>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).filter(([id]) => !id.startsWith(prefix)));
    setRows((current) => ({ ...keep(current), ...next }));
    setOutcomes((current) => keep(current));
  }, []);

  function edit(rowId: string, key: string, value: string) {
    setRows((current) => {
      const row = current[rowId];
      if (!row) return current;
      const { card } = row;
      const fields = { ...card.fields } as Record<string, unknown>;
      if (key === "amount" || key === "day") {
        const n = value.trim() === "" ? null : Number(value.replace(/[,，]/g, ""));
        fields[key] = n !== null && Number.isFinite(n) ? (card.kind === "subscription" && key === "amount" ? n : Math.round(n)) : null;
      } else {
        fields[key] = value === "" && key !== "title" && key !== "name" && key !== "memo" && key !== "number" ? null : value;
      }
      return { ...current, [rowId]: { ...row, card: { ...card, fields } as Suggestion } };
    });
  }

  /** サブスク一覧を開いたことを控えに残す（#750）。登録できたかは分からないので「開いた」として残る。失敗しても開くのは止めない。 */
  function recordOpened(card: Suggestion) {
    fetch("/api/mail/flow/subscription", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: mailId, fields: card.fields }),
      keepalive: true,
    })
      .then(() => router.refresh())
      .catch(() => {});
  }

  /**
   * `/apply` を1回呼ぶ（家計簿のタブは扱わない）。まとめて登録（#1051）と行ごとの登録の共通部分。
   * HTTP・通信の失敗はここで行に表示し `data: null` を返す。`ok` は登録できたとき真。
   */
  async function applyOne(rowId: string, raw: Suggestion): Promise<{ ok: boolean; data: ApplyResponse | null }> {
    // タスクには、同じメールの追跡番号をメモに入れる（#1211。シートで外せる）
    const tracking = raw.kind === "task" && !raw.fields.tracking && !rows[rowId]?.skipTracking ? attachableTracking(rows, rowId) : null;
    const card: Suggestion = raw.kind === "task" && tracking ? { ...raw, fields: { ...raw.fields, tracking } } : raw;
    try {
      const response = await fetch("/api/mail/flow/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: mailId, kind: card.kind, fields: card.fields, confidence: card.confidence }),
      });
      const data = (await response.json().catch(() => null)) as ApplyResponse | null;
      if (!response.ok) {
        setOutcomes((o) => ({ ...o, [rowId]: { text: data?.error ?? `実行できませんでした（HTTP ${response.status}）。`, error: true, done: false } }));
        return { ok: false, data: null };
      }
      return { ok: data?.status !== "failed", data: data ?? {} };
    } catch {
      setOutcomes((o) => ({ ...o, [rowId]: { text: "実行できませんでした（通信できませんでした）。", error: true, done: false } }));
      return { ok: false, data: null };
    }
  }

  /**
   * 選んだ行をまとめて登録する（#1051。タスク・予定だけ）。`/apply` を1件ずつ順に呼ぶ（検証・冪等キー・予定の重複確認は行ごとの登録と同じ）。
   * 途中で失敗しても残りは続け、成功した行は残る。
   */
  async function runMany(rowIds: string[]): Promise<{ kind: Suggestion["kind"]; ok: boolean }[]> {
    const results: { kind: Suggestion["kind"]; ok: boolean }[] = [];
    let anyDone = false;
    setBulkRunning(true);
    try {
      for (const rowId of rowIds) {
        const card = rows[rowId]?.card;
        if (!card) continue;
        setRunning(rowId);
        const { ok, data } = await applyOne(rowId, card);
        if (data) {
          setOutcomes((o) => ({ ...o, [rowId]: { text: `${data.message ?? "実行しました。"}${data.labeled ? "「処理済み」ラベルを付けました。" : ""}`, error: !ok, done: ok } }));
        }
        anyDone ||= ok;
        results.push({ kind: card.kind, ok });
      }
    } finally {
      setRunning(null);
      setBulkRunning(false);
    }
    if (anyDone) router.refresh();
    return results;
  }

  async function run(rowId: string, card: Suggestion) {
    setRunning(rowId);
    // 家計簿は作ったレシートをAsset Managerで開く（#781）。作り終わってから開くとポップアップとして止められるので、
    // 押した瞬間（最初のawaitより前）に空のタブを開いておき、後でそこをレシートの画面へ向ける。iOSの殻は新しいウインドウを作らないので、
    // 作り終わってから画面ごと移る（殻がAsset Managerアプリへ渡す。#744）
    const inApp = /MorrowIOS\//.test(navigator.userAgent);
    const tab = card.kind === "payment" && !inApp ? window.open("", "_blank") : null;
    if (tab) {
      tab.opener = null;
      try {
        tab.document.title = "Asset Manager";
        tab.document.body.textContent = "Asset Managerのレシートを作っています…";
      } catch {
        // 書けなくても開く先は変わらない
      }
    }
    let opened = false;
    try {
      const { data } = await applyOne(rowId, card);
      // HTTPの失敗・通信の失敗は `applyOne()` が表示済み
      if (!data) return;
      const failed = data.status === "failed";
      const href = card.kind === "payment" && !failed ? (receiptUrl(data.receiptId) ?? undefined) : undefined;
      if (href) {
        if (tab) {
          tab.location.href = href;
          opened = true;
        } else if (inApp) {
          window.location.href = href;
        }
      }
      const noReceipt = card.kind === "payment" && !failed && !href ? "レシートの画面を開けませんでした。Asset Managerの家計簿連携から開いてください。" : "";
      setOutcomes((o) => ({
        ...o,
        [rowId]: { text: `${data.message ?? "実行しました。"}${data.labeled ? "「処理済み」ラベルを付けました。" : ""}${noReceipt}`, error: failed, done: !failed, receipt: card.kind === "payment" && (data.status === "pending" || data.status === "duplicate") ? data.status : undefined, href },
      }));
      // 登録した内容の欄（#750）と「処理済み」ラベルを更新する
      if (!failed) router.refresh();
    } finally {
      // 開けなかった（失敗した・レシートのidが返らなかった）ら空のタブを閉じる
      if (tab && !opened) tab.close();
      setRunning(null);
    }
  }

  /** 追跡番号を既存タスクのメモに追記する（#1211）。結果は追跡の行に出す。 */
  async function appendTracking(rowId: string, target: TrackingTaskTarget) {
    const card = rows[rowId]?.card;
    if (card?.kind !== "tracking") return;
    setRunning(rowId);
    try {
      const response = await fetch("/api/mail/flow/tracking-task", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: mailId, taskId: target.taskId, carrier: card.fields.carrier, number: card.fields.number }),
      });
      const data = (await response.json().catch(() => null)) as ApplyResponse | null;
      if (!response.ok) {
        setOutcomes((o) => ({ ...o, [rowId]: { text: data?.error ?? `追記できませんでした（HTTP ${response.status}）。`, error: true, done: false } }));
        return;
      }
      setOutcomes((o) => ({ ...o, [rowId]: { text: data?.message ?? "追記しました。", error: false, done: true, href: linkAppUrl("task", target.dateText) } }));
      router.refresh();
    } catch {
      setOutcomes((o) => ({ ...o, [rowId]: { text: "追記できたか分かりません（通信できませんでした）。タスクを確かめてください。", error: true, done: false } }));
    } finally {
      setRunning(null);
    }
  }

  /** 追跡番号を入れた新しいタスクを作る（#1211）。作る経路はタスクの提案と同じ `/apply`。 */
  async function createTrackingTask(rowId: string, title: string, planned: string | null) {
    const card = rows[rowId]?.card;
    if (card?.kind !== "tracking") return;
    const task: Suggestion = {
      kind: "task",
      reason: "",
      confidence: card.confidence,
      fields: { title, due: null, dueTime: null, planned, plannedTime: null, memo: "", tracking: { carrier: card.fields.carrier, number: card.fields.number } },
    };
    setRunning(rowId);
    try {
      const { ok, data } = await applyOne(rowId, task);
      if (!data) return;
      setOutcomes((o) => ({ ...o, [rowId]: { text: data.message ?? "実行しました。", error: !ok, done: ok, href: ok ? taskOpenUrl(task.fields) : undefined } }));
      if (ok) router.refresh();
    } finally {
      setRunning(null);
    }
  }

  const openRow = open ? rows[open] : undefined;
  const sheet = (
    <FlowSheet
      mailId={mailId}
      attachable={open && openRow?.card.kind === "task" ? attachableTracking(rows, open) : null}
      attach={!openRow?.skipTracking}
      onToggleAttach={(on) => open && setRows((current) => (current[open] ? { ...current, [open]: { ...current[open], skipTracking: !on } } : current))}
      onAppendTracking={(target) => open && void appendTracking(open, target)}
      onCreateTrackingTask={(title, planned) => open && void createTrackingTask(open, title, planned)}
      card={openRow?.card ?? null}
      recommended={openRow?.recommended ?? false}
      outcome={open ? outcomes[open] : undefined}
      match={open ? matches[open] : undefined}
      onChangeLink={(subscriptionId) => (open ? changeLink(open, subscriptionId) : Promise.resolve(null))}
      calendars={calendars}
      running={open !== null && (running === open || bulkRunning)}
      onEdit={(_kind, key, value) => open && edit(open, key, value)}
      onRun={(card) => open && void run(open, card)}
      onOpenSubscription={recordOpened}
      onClose={() => setOpen(null)}
    />
  );

  return { rows, outcomes, matches, running, bulkRunning, runMany, replace, setOpen, sheet };
}

export type FlowCards = ReturnType<typeof useFlowCards>;

type ApplyResponse = { message?: string; error?: string; status?: string; labeled?: boolean; receiptId?: number };
