"use client";

import { LocateFixed, X } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

import { jstTimeLabel } from "@/lib/day-key";

/**
 * 右上の「現在地」バッジ（#586・#625）。**押したときだけ**位置を取り、`POST /api/weather/here` へ渡す。
 * 常時の追跡はしない。位置はサーバーでも保存しない（小数2桁に丸めて送る）。
 *
 * - iOSアプリ（殻。UAに `MorrowIOS/`）でも出す（#587）。殻のInfo.plistに位置の利用目的があり、WKWebViewが
 *   OSの許可ダイアログを経由して位置を渡す。利用目的を持たない古い殻では拒否として返るので、案内の文を分ける
 * - `navigator.geolocation` はHTTPSか `localhost` でしか使えない。無い環境でも出さない
 */

type Result = {
  place: string | null;
  today: { summary: string; max: number | null; min: number | null; pop: number | null } | null;
  next: { pop: number | null; rainFrom: string | null };
  attribution: string;
};

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; result: Result; at: Date }
  | { kind: "denied"; inApp: boolean }
  | { kind: "failed"; message: string };

const RAIN_POP = 50;

const noSubscribe = () => () => {};
// サーバーでは判定できないので、サーバー側の描画では出さない（ハイドレーション後に決まる）。
const canLocate = () => "geolocation" in navigator;
const isInApp = () => /MorrowIOS\//.test(navigator.userAgent);
const cannotLocate = () => false;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function temp(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}°`;
}

function nextLabel(next: Result["next"]): string {
  if (next.pop === null) return "この先3時間: 予報がありません";
  if (next.rainFrom) return `この先3時間: ${Number(next.rainFrom.slice(0, 2))}時ごろから雨（最大 ${next.pop}%）`;
  return `この先3時間: 雨の心配はなさそうです（最大 ${next.pop}%）`;
}

function currentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 15_000, maximumAge: 5 * 60_000 }),
  );
}

export function CurrentLocationWeather() {
  const supported = useSyncExternalStore(noSubscribe, canLocate, cannotLocate);
  const [state, setState] = useState<State>({ kind: "idle" });
  const [dismissed, setDismissed] = useState(false);

  if (!supported) return null;

  async function load() {
    setState({ kind: "loading" });
    let position: GeolocationPosition;
    try {
      position = await currentPosition();
    } catch (error) {
      const denied = (error as GeolocationPositionError | undefined)?.code === 1;
      setState(denied ? { kind: "denied", inApp: isInApp() } : { kind: "failed", message: "位置を取得できませんでした。少し待ってもう一度押してください。" });
      return;
    }

    try {
      const response = await fetch("/api/weather/here", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latitude: round2(position.coords.latitude), longitude: round2(position.coords.longitude) }),
      });
      const json = (await response.json().catch(() => null)) as (Result & { error?: string }) | null;
      if (!response.ok || !json) {
        setState({ kind: "failed", message: json?.error ?? "天気を取得できませんでした。少し待ってもう一度押してください。" });
        return;
      }
      setState({ kind: "ok", result: json, at: new Date() });
    } catch {
      setState({ kind: "failed", message: "通信できませんでした。少し待ってもう一度押してください。" });
    }
  }

  const loading = state.kind === "loading";
  const showPanel = !dismissed && state.kind !== "idle" && state.kind !== "loading";

  return (
    <span className="relative inline-flex tracking-normal">
      <button
        type="button"
        onClick={() => {
          setDismissed(false);
          void load();
        }}
        disabled={loading}
        aria-label="現在地の天気を見る（押したときだけ位置を取ります。保存しません）"
        className="inline-flex items-center gap-1 rounded-full border border-border bg-background py-px pr-2.5 pl-1.5 text-xs font-semibold text-foreground hover:bg-rail-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
      >
        <LocateFixed className="size-3 text-accent" aria-hidden="true" />
        {loading ? "取得しています…" : "現在地"}
      </button>
      {showPanel && (
        <div className="absolute top-full right-0 z-20 mt-1.5 flex w-[min(18rem,calc(100vw-3rem))] flex-col gap-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-[0.8125rem] font-normal shadow-lg">
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="閉じる"
            className="absolute top-1.5 right-1.5 rounded-full p-0.5 text-muted hover:bg-rail-active focus-visible:outline-2 focus-visible:outline-accent"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
          {state.kind === "ok" && (
            <>
              <div className="flex flex-col pr-5">
                <b>現在地{state.result.place ? `・${state.result.place}` : ""}</b>
                <span className="text-[0.6875rem] tabular-nums text-muted">{jstTimeLabel(state.at)} 取得・保存しません</span>
              </div>
              {state.result.today && (
                <span className="tabular-nums">
                  {state.result.today.summary}　最高 {temp(state.result.today.max)} ／ 最低 {temp(state.result.today.min)}
                  {state.result.today.pop !== null && `　降水 ${state.result.today.pop}%`}
                </span>
              )}
              <span
                className={
                  state.result.next.pop !== null && state.result.next.pop >= RAIN_POP
                    ? "font-semibold tabular-nums text-topic"
                    : "tabular-nums text-muted"
                }
              >
                {nextLabel(state.result.next)}
              </span>
              <span className="text-[0.6875rem] text-muted">もう一度押すと取り直します。</span>
            </>
          )}
          {state.kind === "denied" && (
            <p className="pr-5 leading-relaxed text-muted">
              {state.inApp
                ? "位置情報を使えませんでした。設定アプリの「Morrow」で位置情報を許可すると見られます。許可の項目が無いときは、アプリを最新版に更新してください。"
                : "位置情報を使えませんでした。ブラウザの設定で、このサイトの位置情報を許可すると見られます。"}
            </p>
          )}
          {state.kind === "failed" && (
            <p role="status" className="pr-5 leading-relaxed text-danger">
              {state.message}
            </p>
          )}
        </div>
      )}
    </span>
  );
}
