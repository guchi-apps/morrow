"use client";

import { useState } from "react";

import { setAppBadge } from "@/lib/app-badge";
import { cn } from "@/lib/utils";

/** アプリアイコンのバッジ（未読メール件数）のオン・オフ（#1144）。切り替えるとすぐ保存し、失敗したら戻す。 */
export function AppBadgeCard({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !enabled;
    setEnabled(next);
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/settings/app-badge", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!response.ok) throw new Error("保存できませんでした。");
      // オフにしたらその場で消す（オンは画面の同期部品が次の更新で出す）
      if (!next) void setAppBadge(0);
    } catch (e) {
      setEnabled(!next);
      setError(e instanceof Error ? e.message : "保存できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <header>
        <h3 className="text-sm font-medium">アプリアイコンのバッジ</h3>
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-muted">
          ホーム画面のアイコンに、未読メールの件数を表示します。メールメニューの件数と同じ数です。
        </p>
      </header>
      <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3.5">
        <span className="min-w-0 flex-1 text-sm font-medium">未読メールの件数を表示する</span>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="アプリアイコンのバッジ"
          disabled={busy}
          onClick={toggle}
          className={cn(
            "relative h-6 w-[42px] shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            enabled ? "bg-accent" : "bg-border",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "absolute left-[3px] top-[3px] size-[18px] rounded-full bg-white shadow transition-transform",
              enabled && "translate-x-[18px]",
            )}
          />
        </button>
      </div>
      <p className="text-xs leading-relaxed text-muted">
        アプリを開いたとき・戻ったとき・開いている間に更新します。25件を超える分は数えません（アイコンは数字のみ）。
      </p>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
