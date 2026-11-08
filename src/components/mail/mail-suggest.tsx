"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { Suggestion, SuggestKind, SuggestResult } from "@/lib/mail/suggest-core";
import { subscriptionLink } from "@/lib/mail/subscription-link";
import { cn } from "@/lib/utils";

/**
 * メールの提案（#689）。「このメールをどうする？」で本文をAIに読ませ、おすすめと候補カードを出す。
 * 実行はカードごとに利用者が押したときだけ。値は直せる（サーバーが検証し直す）。
 * 型だけをimportする（`suggest-core.ts` はサーバー専用の依存を持つため、値は読み込まない）。
 */

const KIND_META: Record<SuggestKind, { icon: string; title: string; run: string }> = {
  payment: { icon: "🧾", title: "家計簿へ取り込む", run: "取り込む" },
  subscription: { icon: "🔁", title: "サブスクを確認する（Asset Managerで）", run: "Asset Managerのサブスク一覧を開く ↗" },
  task: { icon: "📌", title: "タスクにする", run: "タスクを作る" },
  event: { icon: "📅", title: "予定にする", run: "予定を登録する" },
};

type CardResult = { text: string; error: boolean; done: boolean };

const input = "rounded-md border border-border bg-surface px-2 py-1 text-xs";

export function MailSuggest({ id }: { id: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SuggestResult | null>(null);
  const [cards, setCards] = useState<Suggestion[]>([]);
  const [outcomes, setOutcomes] = useState<Record<string, CardResult>>({});
  const [running, setRunning] = useState<string | null>(null);

  async function suggest() {
    setLoading(true);
    setError(null);
    setOutcomes({});
    try {
      const response = await fetch("/api/mail/flow/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = (await response.json().catch(() => null)) as (SuggestResult & { error?: string }) | null;
      if (!response.ok || !data) {
        setError(data?.error ?? `提案を作れませんでした（HTTP ${response.status}）。`);
        return;
      }
      setResult(data);
      // おすすめを先頭に並べる
      setCards([...data.suggestions].sort((a, b) => Number(b.kind === data.recommended) - Number(a.kind === data.recommended)));
    } catch {
      setError("提案を作れませんでした（通信できませんでした）。");
    } finally {
      setLoading(false);
    }
  }

  function edit(kind: SuggestKind, key: string, value: string) {
    setCards((current) =>
      current.map((card) => {
        if (card.kind !== kind) return card;
        const fields = { ...card.fields } as Record<string, unknown>;
        if (key === "amount" || key === "day") {
          const n = value.trim() === "" ? null : Number(value.replace(/[,，]/g, ""));
          fields[key] = n !== null && Number.isFinite(n) ? (card.kind === "subscription" && key === "amount" ? n : Math.round(n)) : null;
        } else {
          fields[key] = value === "" && key !== "title" && key !== "name" && key !== "memo" ? null : value;
        }
        return { ...card, fields } as Suggestion;
      }),
    );
  }

  async function run(card: Suggestion) {
    setRunning(card.kind);
    try {
      const response = await fetch("/api/mail/flow/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, kind: card.kind, fields: card.fields, confidence: card.confidence }),
      });
      const data = (await response.json().catch(() => null)) as { message?: string; error?: string; status?: string; labeled?: boolean } | null;
      if (!response.ok) {
        setOutcomes((o) => ({ ...o, [card.kind]: { text: data?.error ?? `実行できませんでした（HTTP ${response.status}）。`, error: true, done: false } }));
        return;
      }
      const failed = data?.status === "failed";
      setOutcomes((o) => ({
        ...o,
        [card.kind]: { text: `${data?.message ?? "実行しました。"}${data?.labeled ? "「処理済み」ラベルを付けました。" : ""}`, error: failed, done: !failed },
      }));
      if (data?.labeled) router.refresh();
    } catch {
      setOutcomes((o) => ({ ...o, [card.kind]: { text: "実行できませんでした（通信できませんでした）。", error: true, done: false } }));
    } finally {
      setRunning(null);
    }
  }

  return (
    <section className="flex flex-col gap-2.5" aria-label="AIの提案">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={suggest}
          disabled={loading}
          className="rounded-[9px] border border-border bg-surface px-3 py-1.5 text-xs font-bold transition-colors hover:bg-rail-active disabled:opacity-50"
        >
          {loading ? "本文を読んでいます…" : result ? "✨ もう一度提案する" : "✨ このメールをどうする？"}
        </button>
        {loading && <span className="text-[0.6875rem] text-muted">30秒ほどかかることがあります</span>}
      </div>

      {error && (
        <p role="alert" className="rounded-[10px] border border-danger/30 bg-danger-surface px-3.5 py-2.5 text-xs leading-relaxed text-danger">
          {error}
        </p>
      )}

      {result && cards.length === 0 && (
        <p className="rounded-[10px] border border-border bg-surface px-3.5 py-2.5 text-xs text-muted">
          このメールには、とくに必要な処理は見つかりませんでした。
        </p>
      )}

      {cards.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface px-3 py-3">
          <p className="text-[0.6875rem] text-muted">本文を読んで推論しました。外れることがあるので、内容を確かめてから実行してください。</p>
          {cards.map((card) => {
            const meta = KIND_META[card.kind];
            const recommended = card.kind === result?.recommended;
            const outcome = outcomes[card.kind];
            const f = card.fields as Record<string, string | number | null>;
            return (
              <div key={card.kind} className={cn("flex flex-col gap-1.5 rounded-[10px] border bg-background px-3 py-2.5", recommended ? "border-2 border-accent" : "border-border")}>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <b>
                    {meta.icon} {meta.title}
                  </b>
                  {recommended && <span className="rounded-full bg-accent px-2 py-0.5 text-[0.6875rem] font-bold text-accent-foreground">おすすめ</span>}
                </div>
                {card.reason && (
                  <p className="text-[0.6875rem] text-muted">
                    {card.reason}（確度 {card.confidence >= 0.75 ? "高" : card.confidence >= 0.45 ? "中" : "低"}）
                  </p>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {card.kind === "payment" && (
                    <>
                      <input aria-label="名称" className={input} value={String(f.name ?? "")} onChange={(e) => edit("payment", "name", e.target.value)} placeholder="名称" />
                      <input aria-label="金額（円）" inputMode="numeric" className={cn(input, "w-28")} value={f.amount ?? ""} onChange={(e) => edit("payment", "amount", e.target.value)} placeholder="金額（円）" />
                      <input aria-label="日付" type="date" className={input} value={String(f.date ?? "")} onChange={(e) => edit("payment", "date", e.target.value)} />
                    </>
                  )}
                  {card.kind === "subscription" && (
                    <>
                      <input aria-label="名称" className={input} value={String(f.name ?? "")} onChange={(e) => edit("subscription", "name", e.target.value)} placeholder="名称" />
                      <input aria-label="金額" inputMode="decimal" className={cn(input, "w-24")} value={f.amount ?? ""} onChange={(e) => edit("subscription", "amount", e.target.value)} placeholder="金額" />
                      <select aria-label="通貨" className={input} value={String(f.currency)} onChange={(e) => edit("subscription", "currency", e.target.value)}>
                        <option value="JPY">円</option>
                        <option value="USD">ドル</option>
                      </select>
                      <select aria-label="周期" className={input} value={String(f.cycle)} onChange={(e) => edit("subscription", "cycle", e.target.value)}>
                        <option value="MONTHLY">毎月</option>
                        <option value="YEARLY">毎年</option>
                      </select>
                      <input aria-label="請求日" inputMode="numeric" className={cn(input, "w-16")} value={f.day ?? ""} onChange={(e) => edit("subscription", "day", e.target.value)} placeholder="請求日" />
                      <input aria-label="開始日" type="date" className={input} value={String(f.startDate ?? "")} onChange={(e) => edit("subscription", "startDate", e.target.value)} />
                    </>
                  )}
                  {card.kind === "task" && (
                    <>
                      <input aria-label="題名" className={cn(input, "min-w-[12rem] flex-1")} value={String(f.title ?? "")} onChange={(e) => edit("task", "title", e.target.value)} />
                      <input aria-label="期限" type="date" className={input} value={String(f.due ?? "")} onChange={(e) => edit("task", "due", e.target.value)} />
                    </>
                  )}
                  {card.kind === "event" && (
                    <>
                      <input aria-label="題名" className={cn(input, "min-w-[12rem] flex-1")} value={String(f.title ?? "")} onChange={(e) => edit("event", "title", e.target.value)} />
                      <input aria-label="日付" type="date" className={input} value={String(f.date ?? "")} onChange={(e) => edit("event", "date", e.target.value)} />
                      <input aria-label="開始" type="time" className={input} value={String(f.startTime ?? "")} onChange={(e) => edit("event", "startTime", e.target.value)} />
                      <input aria-label="終了" type="time" className={input} value={String(f.endTime ?? "")} onChange={(e) => edit("event", "endTime", e.target.value)} />
                    </>
                  )}
                </div>
                {card.kind === "payment" && (f.amount === null || f.date === null) && (
                  <p className="text-[0.6875rem] text-danger">要確認: 本文から読み取れなかった項目があります。入力してください。</p>
                )}
                <div>
                  {card.kind === "subscription" ? (
                    <a
                      href={subscriptionLink(card.fields)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn("inline-block rounded-[9px] px-3 py-1.5 text-xs font-bold transition-colors", recommended ? "bg-accent text-accent-foreground" : "border border-border bg-surface hover:bg-rail-active")}
                    >
                      {meta.run}
                    </a>
                  ) : (
                  <button
                    type="button"
                    disabled={running !== null || outcome?.done === true}
                    onClick={() => run(card)}
                    className={cn(
                      "rounded-[9px] px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-50",
                      recommended ? "bg-accent text-accent-foreground" : "border border-border bg-surface hover:bg-rail-active",
                    )}
                  >
                    {running === card.kind ? "実行しています…" : outcome?.done ? "実行済み" : meta.run}
                  </button>
                  )}
                  {card.kind === "subscription" && (
                    <p className="mt-1 text-[0.6875rem] text-muted">入力欄の内容は引き継がれません。一覧が開くだけなので、登録はAsset Manager側で行ってください。</p>
                  )}
                </div>
                {outcome && (
                  <p role={outcome.error ? "alert" : "status"} className={cn("text-[0.6875rem]", outcome.error ? "text-danger" : "text-muted")}>
                    {outcome.text}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
