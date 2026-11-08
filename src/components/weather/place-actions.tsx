"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { cn } from "@/lib/utils";

/**
 * 地点の登録・削除ボタン（#695）。押したら `/api/weather/places` へ送り、画面を読み直す。
 * 削除したときは、見ていた地点がもう無いので一覧だけの画面（`/weather`）へ戻す。
 */
export function PlaceActions({
  name,
  latitude,
  longitude,
  registered,
}: {
  name: string;
  latitude: number;
  longitude: number;
  registered: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function send(method: "POST" | "DELETE") {
    setError(null);
    try {
      const response = await fetch("/api/weather/places", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, latitude, longitude }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "保存できませんでした。");
        return;
      }
      startTransition(() => {
        if (method === "DELETE") router.replace("/weather");
        router.refresh();
      });
    } catch {
      setError("通信に失敗しました。");
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => send(registered ? "DELETE" : "POST")}
        className={cn(
          "rounded-full border px-3 py-1 text-xs font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50",
          registered ? "border-border text-muted hover:bg-rail-active" : "border-accent text-accent hover:bg-accent-surface",
        )}
      >
        {registered ? "登録を外す" : "この地点を登録する"}
      </button>
      {error && (
        <span role="status" className="text-[0.6875rem] text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
