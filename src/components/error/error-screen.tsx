"use client";

import { useEffect, useState } from "react";

import { canAutoReload, isRecoverableError, parseReloadMark } from "@/lib/recoverable-error";

const MARK_KEY = "morrow:auto-reload";

/**
 * 画面のエラー境界の中身（#863）。`(chat)/error.tsx` と `global-error.tsx` が共有する。
 * 通信が途切れた種類の例外（`isRecoverableError()`）なら、画面が表に出ている時点で1回だけ自動で読み込み直す
 * （裏にいる間は待つ）。同じURLで続けて起きたら、ボタンの画面で止める（`canAutoReload()`）。
 * 読み込み直しは `reset()` ではなく `location.reload()`——途中で切れたRSCは同じ木を描き直しても直らないため。
 */
export function ErrorScreen({ error }: { error: Error & { digest?: string } }) {
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    console.error(error);
    if (!isRecoverableError(error)) return;
    const url = window.location.pathname + window.location.search;
    let previous = null;
    try {
      previous = parseReloadMark(window.sessionStorage.getItem(MARK_KEY));
    } catch {
      // 保存領域が使えない環境では、毎回自動で読み込み直す側へ倒さず止める
      return;
    }
    if (!canAutoReload(previous, url, Date.now())) return;

    const reload = () => {
      try {
        window.sessionStorage.setItem(MARK_KEY, JSON.stringify({ url, at: Date.now() }));
      } catch {
        return;
      }
      setReloading(true);
      window.location.reload();
    };
    if (document.visibilityState === "visible") {
      reload();
      return;
    }
    const onVisible = () => {
      if (document.visibilityState === "visible") reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [error]);

  const recoverable = isRecoverableError(error);

  return (
    <div role="alert" style={{ display: "flex", minHeight: "60vh", flex: 1, alignItems: "center", justifyContent: "center", padding: "24px 16px" }}>
      <div style={{ maxWidth: 360, display: "flex", flexDirection: "column", gap: 12, fontSize: 14, lineHeight: 1.6 }}>
        <p style={{ fontSize: 17, fontWeight: 700 }}>{recoverable ? "通信が途切れました" : "画面を表示できませんでした"}</p>
        <p style={{ opacity: 0.75 }}>
          {reloading
            ? "読み込み直しています…"
            : recoverable
              ? "アプリを切り替えている間に通信が切れたようです。読み込み直してください。"
              : "時間をおいて読み込み直してください。続くときはトップから開き直してください。"}
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            disabled={reloading}
            onClick={() => window.location.reload()}
            style={{ borderRadius: 10, padding: "8px 16px", fontWeight: 700, background: "#344458", color: "#fff", border: "none", opacity: reloading ? 0.6 : 1 }}
          >
            読み込み直す
          </button>
          {/* 壊れた画面の状態を持ち越さないよう、クライアントの遷移ではなく通常の読み込みで開く */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" style={{ borderRadius: 10, padding: "8px 16px", border: "1px solid rgba(127,127,127,0.4)", color: "inherit", textDecoration: "none" }}>
            トップへ
          </a>
        </div>
      </div>
    </div>
  );
}
