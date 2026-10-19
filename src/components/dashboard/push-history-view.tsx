import { PushList } from "@/components/dashboard/dashboard-view";
import type { DeliveredPush } from "@/lib/dashboard/today";
import type { PushDay } from "@/lib/dashboard/push-history";

/**
 * 届いた通知（`/pushes`。#581）。**見るだけの画面で、操作は置かない。**
 *
 * 送った通知の本文（`NotificationLog`）を日付ごとに新しい順で並べる。ダッシュボードは今日の分だけなので、
 * 端末に残っている前日以前の通知（押すと `/` や古い `/c/<ID>` が開く）の本文はここで読む。
 */
export function PushHistoryView({ days, limit }: { days: PushDay<DeliveredPush>[]; limit: number }) {
  const total = days.reduce((sum, day) => sum + day.pushes.length, 0);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-3 px-3.5 py-4 md:gap-4 md:px-7 md:py-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-bold tracking-wide md:text-[1.375rem]">届いた通知</h2>
          <p className="text-xs text-muted">
            朝の見通し・急ぎのお知らせ・先回りの提案などで送った本文です。定時のお知らせは話題の画面にあります。
          </p>
        </div>

        {days.length === 0 ? (
          <p className="rounded-[10px] border border-dashed border-border bg-background px-3 py-2.5 text-[0.8125rem] leading-relaxed text-muted">
            まだ通知を送っていません。
          </p>
        ) : (
          days.map((day) => (
            <section
              key={day.dayKey}
              aria-label={day.label}
              className="flex min-w-0 flex-col gap-2.5 rounded-xl border border-border bg-surface px-4 py-3.5 md:rounded-2xl md:px-[18px] md:py-4"
            >
              <h3 className="text-xs font-bold tracking-[0.1em] text-muted">{day.label}</h3>
              <PushList pushes={day.pushes} />
            </section>
          ))
        )}

        {total >= limit && <p className="text-xs text-muted">新しいものから{limit}件まで出しています。</p>}
      </div>
    </div>
  );
}
