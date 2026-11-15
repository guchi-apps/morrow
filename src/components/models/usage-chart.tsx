"use client";

import { useMemo, useState } from "react";

import { MODEL_USE_META } from "@/lib/chat-model";
import { USAGE_BUCKETS, formatTokens, niceMax, type DayUsage } from "@/lib/usage-daily";
import type { UsageBucket } from "@/lib/usage-feature";
import { cn } from "@/lib/utils";

/**
 * 用途別・日毎のトークン使用量（#945）。日本時間の日付で積み上げた棒を並べ、棒を押すとその日の内訳を出す。
 * 金額は出さない（Codexはサブスク定額で実請求が無い）。グラフライブラリは使わず、divで描く。
 */

const PERIODS = [7, 14, 30] as const;

const BUCKET_LABEL: Record<UsageBucket, string> = {
  topic: MODEL_USE_META.topic.label,
  mail: MODEL_USE_META.mail.label,
  mail_suggest: MODEL_USE_META.mail_suggest.label,
  other: "その他",
};

const BUCKET_COLOR: Record<UsageBucket, string> = {
  topic: "var(--account-coral)",
  mail_suggest: "var(--account-teal)",
  mail: "var(--account-blue)",
  other: "var(--muted)",
};

function dayLabel(day: string): string {
  const [, month, date] = day.split("-");
  return `${Number(month)}/${Number(date)}`;
}

export function UsageChart({ days }: { days: DayUsage[] | null }) {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>(7);
  const [selected, setSelected] = useState<string | null>(null);

  const shown = useMemo(() => (days ? days.slice(-period) : []), [days, period]);

  if (!days) {
    return (
      <section className="rounded-xl border border-border bg-surface px-3.5 py-3">
        <h2 className="text-base font-medium">トークン使用量</h2>
        <p role="alert" className="mt-2 text-sm text-danger">
          使用量を取得できませんでした。時間をおいて開き直してください。
        </p>
      </section>
    );
  }

  const total = shown.reduce((sum, d) => sum + d.total, 0);
  const calls = shown.reduce((sum, d) => sum + d.calls, 0);
  const max = niceMax(Math.max(0, ...shown.map((d) => d.total)));
  const detail = shown.find((d) => d.day === selected) ?? null;
  const rows = USAGE_BUCKETS.map((bucket) => {
    const source = detail ? [detail] : shown;
    const sum = source.reduce(
      (acc, d) => {
        const b = d.buckets[bucket];
        return {
          total: acc.total + b.total,
          input: acc.input + b.input,
          output: acc.output + b.output,
          cache: acc.cache + b.cache,
          calls: acc.calls + b.calls,
        };
      },
      { total: 0, input: 0, output: 0, cache: 0, calls: 0 },
    );
    return { bucket, ...sum };
  });
  const everyN = shown.length > 14 ? 5 : shown.length > 7 ? 2 : 1;

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface px-3.5 py-3" aria-labelledby="usage-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="usage-title" className="text-base font-medium">
          トークン使用量
        </h2>
        <div role="group" aria-label="期間" className="flex gap-1">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={period === p}
              onClick={() => {
                setPeriod(p);
                setSelected(null);
              }}
              className={cn(
                "rounded-full border border-border px-2.5 py-0.5 text-xs text-muted",
                period === p && "border-accent bg-accent-surface font-semibold text-accent",
              )}
            >
              {p}日
            </button>
          ))}
        </div>
      </div>
      <p className="text-[0.72rem] leading-snug text-muted">
        日毎の合計（入力・出力・キャッシュ）。サブスク定額のため金額は出しません。
      </p>

      <dl className="flex gap-5">
        <div>
          <dt className="text-[0.6875rem] text-muted">期間の合計</dt>
          <dd className="text-lg font-semibold tabular-nums">{formatTokens(total)}</dd>
        </div>
        <div>
          <dt className="text-[0.6875rem] text-muted">1日あたり</dt>
          <dd className="text-lg font-semibold tabular-nums">{formatTokens(Math.round(total / shown.length))}</dd>
        </div>
        <div>
          <dt className="text-[0.6875rem] text-muted">呼び出し</dt>
          <dd className="text-lg font-semibold tabular-nums">{calls}回</dd>
        </div>
      </dl>

      {total === 0 ? (
        <p className="py-6 text-center text-sm text-muted">この期間の使用量の記録はありません。</p>
      ) : (
        <div className="flex gap-1.5">
          <div className="flex h-40 flex-col justify-between text-right text-[0.625rem] tabular-nums text-muted" aria-hidden="true">
            <span>{formatTokens(max)}</span>
            <span>{formatTokens(max / 2)}</span>
            <span>0</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="relative h-40 border-b border-border">
              <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-border" />
              <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-border" />
              <div className="absolute inset-0 flex items-end gap-[3px]">
                {shown.map((d) => (
                  <button
                    key={d.day}
                    type="button"
                    aria-pressed={selected === d.day}
                    aria-label={`${dayLabel(d.day)} ${formatTokens(d.total)}トークン、${d.calls}回`}
                    onClick={() => setSelected(selected === d.day ? null : d.day)}
                    className={cn(
                      "flex h-full min-w-0 flex-1 flex-col-reverse rounded-sm focus-visible:outline-2 focus-visible:outline-accent",
                      selected && selected !== d.day && "opacity-40",
                    )}
                  >
                    {USAGE_BUCKETS.map((bucket) => (
                      <span
                        key={bucket}
                        className="block w-full first:rounded-b-[1px] last:rounded-t-[2px]"
                        style={{ height: `${(d.buckets[bucket].total / max) * 100}%`, background: BUCKET_COLOR[bucket] }}
                      />
                    ))}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-1 flex gap-[3px] text-[0.625rem] text-muted" aria-hidden="true">
              {shown.map((d, i) => (
                <span key={d.day} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center">
                  {(shown.length - 1 - i) % everyN === 0 ? dayLabel(d.day) : ""}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="text-xs font-medium">
        {detail ? `${dayLabel(detail.day)} の内訳（${formatTokens(detail.total)}・${detail.calls}回）` : "用途ごとの合計"}
      </div>
      <ul className="flex flex-col">
        {rows.map((row) => (
          <li key={row.bucket} className="flex items-center gap-2 border-t border-border py-1.5 text-[0.8rem] first:border-t-0">
            <i className="size-2.5 shrink-0 rounded-sm" style={{ background: BUCKET_COLOR[row.bucket] }} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              {BUCKET_LABEL[row.bucket]}
              <small className="block text-[0.6875rem] text-muted">
                入力 {formatTokens(row.input)} ・ 出力 {formatTokens(row.output)} ・ キャッシュ {formatTokens(row.cache)} ・ {row.calls}回
              </small>
            </span>
            <b className="tabular-nums">{formatTokens(row.total)}</b>
          </li>
        ))}
      </ul>
    </section>
  );
}
