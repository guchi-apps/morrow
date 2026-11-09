"use client";

import { useState } from "react";

import { LEARNED_RULES_MAX, type LearnedRule } from "@/lib/mail/learn-core";

/** 「お知らせする基準」カードの「学習した傾向」（#833）。メール本文の画面で付けた印からAIが読み取ったもの。削除できる。 */
export function MailLearnedRules({ initial }: { initial: LearnedRule[] }) {
  const [rules, setRules] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove(target: LearnedRule) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/mail/learned-rules", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        // 名指しで1件だけ消す。見えている一覧を送って置き換えると、別のタブの学習・取り消しを消す（#847）
        body: JSON.stringify({ rule: { text: target.text, notify: target.notify } }),
      });
      const data = (await response.json().catch(() => null)) as { rules?: LearnedRule[]; error?: string } | null;
      if (!response.ok || !Array.isArray(data?.rules)) {
        setError(data?.error ?? "削除できませんでした。");
        return;
      }
      // 応答はサーバーのいまの一覧（別のタブで学習した傾向もここで見える）
      setRules(data.rules);
    } catch {
      setError("削除できませんでした（通信できませんでした）。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs font-bold">学習した傾向（{rules.length}件）</span>
        <span className="text-[0.6875rem] text-muted">書いた基準と合わせて判定に使います</span>
      </div>
      {rules.length === 0 ? (
        <p className="rounded-[9px] border border-dashed border-border px-3 py-2.5 text-[0.6875rem] leading-relaxed text-muted">
          まだありません。メールを開いて「今後このようなメールを 知らせる／知らせない」を押すと、ここに増えます。
        </p>
      ) : (
        <ul className="flex flex-col overflow-hidden rounded-[9px] border border-border">
          {rules.map((rule) => (
            <li key={`${rule.notify}:${rule.text}`} className="flex items-center gap-2 border-t border-border px-2.5 py-2 text-xs first:border-t-0">
              <span
                className={
                  "shrink-0 rounded-full px-2 py-0.5 text-[0.625rem] font-bold " +
                  (rule.notify ? "bg-accent-surface text-accent" : "bg-border/60 text-muted")
                }
              >
                {rule.notify ? "知らせる" : "知らせない"}
              </span>
              <span className="min-w-0 flex-1 leading-snug">{rule.text}</span>
              <span className="hidden shrink-0 text-[0.6875rem] text-muted sm:inline">{rule.at.slice(5).replace("-", "/").replace(/^0/, "")}</span>
              <button
                type="button"
                onClick={() => remove(rule)}
                disabled={busy}
                className="shrink-0 text-[0.6875rem] text-muted underline disabled:opacity-50"
              >
                削除
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[0.6875rem] leading-relaxed text-muted">
        印を押すたびにAIが傾向を足したり直したりします（最大{LEARNED_RULES_MAX}件）。読み取りのため、押したメールの差出人・件名・冒頭（約200字）を
        OpenAI（Codex）へ渡します。メールの件名・本文そのものは保存しません。
      </p>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
