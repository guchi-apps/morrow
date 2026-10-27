"use client";

import { ChevronDown, LocateFixed } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { jstTimeLabel } from "@/lib/day-key";

/**
 * 天気カード先頭の「現在地」折りたたみ行（#586・#625・#631・#641）。位置を取り、`POST /api/weather/here` へ渡す。
 * 取るのは「押したとき」と、**許可済みで画面が前面に来たとき1回**（5分以内は取り直さない）。
 * 常時の追跡（watchPosition）はしない。位置はサーバーでも保存しない（小数2桁に丸めて送る）。
 * 取得済みなら、行には市町村名と「いま」の予報を出し、押すと詳細を開く（既定は畳む）。
 *
 * - iOSアプリ（殻。UAに `MorrowIOS/`）でも出す（#587）。殻のInfo.plistに位置の利用目的があり、WKWebViewが
 *   OSの許可ダイアログを経由して位置を渡す。利用目的を持たない古い殻では拒否として返るので、案内の文を分ける
 * - `navigator.geolocation` はHTTPSか `localhost` でしか使えない。無い環境でも出さない
 */

type Result = {
  place: string | null;
  today: { summary: string; max: number | null; min: number | null; pop: number | null } | null;
  /** いまの時間の予報（#631）。「今日の最高/最低」「この先3時間」とは別枠。 */
  now: { time: string; summary: string; temperature: number | null; pop: number | null } | null;
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
/** 前面に戻るたびに取り直さない間隔。 */
const REFETCH_MS = 5 * 60_000;

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
  const [open, setOpen] = useState(false);
  const lastLoadedAt = useRef(0);
  const busy = useRef(false);

  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    lastLoadedAt.current = Date.now();
    setState({ kind: "loading" });
    let position: GeolocationPosition;
    try {
      position = await currentPosition();
    } catch (error) {
      const denied = (error as GeolocationPositionError | undefined)?.code === 1;
      setState(denied ? { kind: "denied", inApp: isInApp() } : { kind: "failed", message: "位置を取得できませんでした。少し待ってもう一度押してください。" });
      busy.current = false;
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
        // 取り直しの失敗（10秒制限の429など）では、取得済みの結果を消さない
        const message = json?.error ?? "天気を取得できませんでした。少し待ってもう一度押してください。";
        setState((prev) => (prev.kind === "ok" ? prev : { kind: "failed", message }));
        return;
      }
      setState({ kind: "ok", result: json, at: new Date() });
    } catch {
      setState({ kind: "failed", message: "通信できませんでした。少し待ってもう一度押してください。" });
    } finally {
      busy.current = false;
    }
  }, []);

  // 許可済みのときだけ、前面に来たとき自動で1回取る。未許可・判定できない端末では何もしない（押したときだけ）。
  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    async function auto() {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastLoadedAt.current < REFETCH_MS) return;
      try {
        const status = await navigator.permissions?.query({ name: "geolocation" });
        if (cancelled || status?.state !== "granted") return;
      } catch {
        return;
      }
      void load();
    }
    void auto();
    document.addEventListener("visibilitychange", auto);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", auto);
    };
  }, [supported, load]);

  if (!supported) return null;

  const loading = state.kind === "loading";
  const expanded = open && state.kind !== "idle" && state.kind !== "loading";
  const label =
    state.kind === "ok"
      ? `現在地${state.result.place ? `・${state.result.place}` : ""}`
      : state.kind === "loading"
        ? "現在地・取得しています…"
        : state.kind === "denied"
          ? "現在地・位置が許可されていません"
          : state.kind === "failed"
            ? "現在地・位置不明"
            : "現在地";
  // 畳んだ行の右側。取得済みなら「いま」の気温・天気・降水確率だけ出す
  const summary =
    state.kind === "ok" && state.result.now
      ? `${temp(state.result.now.temperature)} ${state.result.now.summary}${state.result.now.pop !== null ? ` ${state.result.now.pop}%` : ""}`
      : null;
  const warn = state.kind === "denied" || state.kind === "failed";
  const panelId = "current-location-panel";

  return (
    <div className="rounded-xl border border-border bg-background text-[0.8125rem] tracking-normal">
      <button
        type="button"
        onClick={() => {
          if (state.kind === "ok") {
            setOpen((v) => !v);
            return;
          }
          setOpen(true);
          void load();
        }}
        disabled={loading}
        aria-expanded={expanded}
        aria-controls={panelId}
        title="アプリを使っている間だけ位置を取ります。保存しません"
        className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left font-semibold text-foreground hover:bg-rail-active focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent disabled:opacity-60"
      >
        <LocateFixed className={warn ? "size-3.5 shrink-0 text-danger" : "size-3.5 shrink-0 text-accent"} aria-hidden="true" />
        <span className="min-w-0 truncate">{label}</span>
        {summary && <span className="ml-auto shrink-0 font-normal tabular-nums text-muted">{summary}</span>}
        <ChevronDown
          className={`size-3.5 shrink-0 text-muted transition-transform ${summary ? "" : "ml-auto"} ${expanded ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      <div id={panelId} hidden={!expanded} className="flex flex-col gap-1 px-3 pb-3 font-normal">
        {state.kind === "ok" && (
          <>
            <span className="text-[0.6875rem] tabular-nums text-muted">{jstTimeLabel(state.at)} 取得・保存しません</span>
            {state.result.now ? (
              <div className="flex flex-col">
                <span className="text-[0.6875rem] text-muted">{state.result.now.time}の予報</span>
                <span className="tabular-nums">
                  <b className="text-lg">{temp(state.result.now.temperature)}</b>　{state.result.now.summary}
                  {state.result.now.pop !== null && `　降水確率 ${state.result.now.pop}%`}
                </span>
              </div>
            ) : (
              <span className="text-muted">この時間の予報がありません</span>
            )}
            {state.result.today && (
              <span className="tabular-nums">
                今日: {state.result.today.summary}　最高 {temp(state.result.today.max)} ／ 最低 {temp(state.result.today.min)}
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
            <button
              type="button"
              onClick={() => void load()}
              className="self-start text-[0.6875rem] text-muted underline focus-visible:outline-2 focus-visible:outline-accent"
            >
              取り直す
            </button>
          </>
        )}
        {state.kind === "denied" && (
          <p className="leading-relaxed text-muted">
            {state.inApp
              ? "位置情報を使えませんでした。設定アプリの「Morrow」で位置情報を許可すると見られます。許可の項目が無いときは、アプリを最新版に更新してください。"
              : "位置情報を使えませんでした。ブラウザの設定で、このサイトの位置情報を許可すると見られます。"}
          </p>
        )}
        {state.kind === "failed" && (
          <p role="status" className="leading-relaxed text-danger">
            {state.message}
          </p>
        )}
      </div>
    </div>
  );
}
