"use client";

import { useState } from "react";

import { MAIL_CRITERIA_MAX } from "@/lib/mail/triage-core";

/** 「お知らせする基準」（#683）。判定のプロンプトへそのまま入る自由記述。空なら既定の基準。 */
export function MailCriteriaForm({ initial, defaultCriteria }: { initial: string; defaultCriteria: string }) {
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [state, setState] = useState<{ text: string; error: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setState(null);
    try {
      const response = await fetch("/api/mail/criteria", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ criteria: value }),
      });
      const data = (await response.json().catch(() => null)) as { criteria?: string; error?: string } | null;
      if (!response.ok || typeof data?.criteria !== "string") {
        setState({ text: data?.error ?? "保存できませんでした。", error: true });
        return;
      }
      setValue(data.criteria);
      setSaved(data.criteria);
      setState({ text: "保存しました。次の確認から使います。", error: false });
    } catch {
      setState({ text: "保存できませんでした（通信できませんでした）。", error: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-[0.6875rem] leading-relaxed text-muted">
        どんなメールを「必要」として知らせてほしいかを書きます。空なら既定の基準（{defaultCriteria}）で判定します。
      </p>
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        maxLength={MAIL_CRITERIA_MAX}
        rows={4}
        placeholder="例: 支払い・期限・予約の確認、家族や役所からの連絡。広告・メルマガ・SNSの通知は要らない。"
        className="w-full resize-y rounded-[9px] border border-border bg-background px-3 py-2 text-xs leading-relaxed focus-visible:outline-2 focus-visible:outline-accent"
      />
      <p className="text-[0.6875rem] leading-relaxed text-muted">
        判定のため、差出人・件名・冒頭（約200字）だけをOpenAI（Codex）へ渡します。本文全体・添付は渡しません。
      </p>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[0.6875rem] text-muted">
          {value.length}/{MAIL_CRITERIA_MAX}字・通知のオン・オフは設定の「通知の種類」
        </span>
        <button
          type="button"
          onClick={save}
          disabled={saving || value === saved}
          className="rounded-[9px] bg-accent px-3.5 py-1.5 text-xs font-semibold text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "保存中…" : "保存"}
        </button>
      </div>
      {state && (
        <p role={state.error ? "alert" : "status"} className={state.error ? "text-xs text-danger" : "text-xs text-muted"}>
          {state.text}
        </p>
      )}
    </div>
  );
}
