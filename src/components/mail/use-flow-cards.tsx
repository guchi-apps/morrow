"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { FlowSheet, type CardResult } from "@/components/mail/flow-sheet";
import { receiptUrl } from "@/lib/mail/payment-receipt";
import type { Suggestion } from "@/lib/mail/suggest-core";

/**
 * 提案の行（分析 #766・指示 #784）の状態と、押したときのハーフモーダル（`FlowSheet`）。1通のメールの画面に1つ。
 *
 * **状態は行ごとの識別子をキーに持つ**（#784の計画レビュー）。以前は種類（payment など）をキーにしていたため、
 * 分析と指示の返事に同じ種類の行が出ると、登録結果・実行中・開いている行が互いに上書きされた。
 * 識別子は呼び出し側が付ける（分析は `a-<n>`、指示は `c<返事の番号>-<n>`）。二重登録は `/apply` の冪等キー・`gmailMessageId` が止める。
 */

export type FlowRow = { card: Suggestion; recommended: boolean };

export function useFlowCards(mailId: string) {
  const router = useRouter();
  const [rows, setRows] = useState<Record<string, FlowRow>>({});
  const [outcomes, setOutcomes] = useState<Record<string, CardResult>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

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
        fields[key] = value === "" && key !== "title" && key !== "name" && key !== "memo" ? null : value;
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
      const response = await fetch("/api/mail/flow/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: mailId, kind: card.kind, fields: card.fields, confidence: card.confidence }),
      });
      const data = (await response.json().catch(() => null)) as { message?: string; error?: string; status?: string; labeled?: boolean; receiptId?: number } | null;
      if (!response.ok) {
        setOutcomes((o) => ({ ...o, [rowId]: { text: data?.error ?? `実行できませんでした（HTTP ${response.status}）。`, error: true, done: false } }));
        return;
      }
      const failed = data?.status === "failed";
      const href = card.kind === "payment" && !failed ? (receiptUrl(data?.receiptId) ?? undefined) : undefined;
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
        [rowId]: { text: `${data?.message ?? "実行しました。"}${data?.labeled ? "「処理済み」ラベルを付けました。" : ""}${noReceipt}`, error: failed, done: !failed, href },
      }));
      // 登録した内容の欄（#750）と「処理済み」ラベルを更新する
      if (!failed) router.refresh();
    } catch {
      setOutcomes((o) => ({ ...o, [rowId]: { text: "実行できませんでした（通信できませんでした）。", error: true, done: false } }));
    } finally {
      // 開けなかった（失敗した・レシートのidが返らなかった）ら空のタブを閉じる
      if (tab && !opened) tab.close();
      setRunning(null);
    }
  }

  const openRow = open ? rows[open] : undefined;
  const sheet = (
    <FlowSheet
      card={openRow?.card ?? null}
      recommended={openRow?.recommended ?? false}
      outcome={open ? outcomes[open] : undefined}
      running={open !== null && running === open}
      onEdit={(_kind, key, value) => open && edit(open, key, value)}
      onRun={(card) => open && void run(open, card)}
      onOpenSubscription={recordOpened}
      onClose={() => setOpen(null)}
    />
  );

  return { rows, outcomes, replace, setOpen, sheet };
}

export type FlowCards = ReturnType<typeof useFlowCards>;
