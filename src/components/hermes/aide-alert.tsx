"use client";

import { useState } from "react";

import { isAideHealth, type AideHealth } from "@/lib/hermes/aide-health";

/**
 * AIDEの道具が読み込まれていないときの赤帯（#1158・#1240）。
 *
 * subpcでコマンドを打たずに直せるよう、2つの操作を出す。
 * - 「再接続する」: HermesのMCPを張り直す（`POST /api/hermes/aide/reconnect`）。一時的な切断ならこれで戻る
 * - 「AIDEに再ログイン」: ログイン（OAuth）を画面から通す。Hermesは戻り先をループバックに限るので、
 *   ログイン後に開けなかったページのURLを貼り付けてもらう（`POST /api/hermes/aide/login`）。
 *   **Hermesは始めた時点で今のトークンを消す**（失敗・取り消し・5分の時間切れで戻す）ので、ログインが切れている
 *   （`login_required`）ときだけ出し、途中でやめる「取り消す」も出す
 *
 * 認可URL・貼り付けたURLは画面のstateにだけ持つ（保存しない）。
 */

type Phase =
  | { kind: "idle" }
  | { kind: "reconnecting" }
  | { kind: "starting" }
  | { kind: "awaiting"; flowId: string; authUrl: string }
  | { kind: "completing"; flowId: string; authUrl: string }
  | { kind: "cancelling" };

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> | null }> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    return { ok: response.ok, data };
  } catch {
    return { ok: false, data: null };
  }
}

function failureText(data: Record<string, unknown> | null): string {
  return typeof data?.error === "string" ? data.error : "通信できませんでした。電波の良い所でもう一度押してください。";
}

/** 操作の結果の状態を、利用者向けの1文にする。 */
function resultText(aide: AideHealth | null): string {
  switch (aide) {
    case "ok":
      return "AIDEの道具を読み込みました。";
    case "connecting":
      return "AIDEへ接続しています。少し待ってから「新しい会話」で確かめてください。";
    case "login_required":
      return "まだAIDEのログインが必要です。「AIDEに再ログイン」を押してください。";
    case "unavailable":
      return "まだAIDEへ接続できません。AIDEが止まっている可能性があります。時間をおいて「再接続する」を押してください。";
    default:
      return "接続の状態を確かめられませんでした。時間をおいて画面を開き直してください。";
  }
}

export function AideAlert({ health, onHealth }: { health: AideHealth; onHealth: (next: AideHealth | null) => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [pasted, setPasted] = useState("");
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const working = phase.kind === "reconnecting" || phase.kind === "starting" || phase.kind === "completing" || phase.kind === "cancelling";
  const loginRequired = health === "login_required";

  function finish(data: Record<string, unknown> | null) {
    const aide = isAideHealth(data?.aide) ? data.aide : null;
    setPhase({ kind: "idle" });
    setPasted("");
    setMessage({ text: resultText(aide), error: aide !== "ok" });
    onHealth(aide);
  }

  async function reconnect() {
    setMessage(null);
    setPhase({ kind: "reconnecting" });
    const { ok, data } = await postJson("/api/hermes/aide/reconnect", {});
    if (!ok) {
      setPhase({ kind: "idle" });
      setMessage({ text: failureText(data), error: true });
      return;
    }
    finish(data);
  }

  async function startLogin() {
    setMessage(null);
    setPasted("");
    setPhase({ kind: "starting" });
    const { ok, data } = await postJson("/api/hermes/aide/login", { action: "start" });
    if (!ok || typeof data?.flowId !== "string" || typeof data.authUrl !== "string" || !data.authUrl.startsWith("https://")) {
      setPhase({ kind: "idle" });
      setMessage({ text: ok ? "ログインを始められませんでした。" : failureText(data), error: true });
      return;
    }
    setPhase({ kind: "awaiting", flowId: data.flowId, authUrl: data.authUrl });
  }

  async function cancelLogin() {
    if (phase.kind !== "awaiting") return;
    const { flowId } = phase;
    setPhase({ kind: "cancelling" });
    const { ok, data } = await postJson("/api/hermes/aide/login", { action: "cancel", flowId });
    setPhase({ kind: "idle" });
    setPasted("");
    // 取り消せなかった流れも、Hermesが5分で時間切れにして元のトークンへ戻す
    setMessage(ok ? { text: "ログインを取り消しました。", error: false } : { text: `${failureText(data)}（5分たつと自動で取り消されます）`, error: true });
  }

  async function completeLogin() {
    if (phase.kind !== "awaiting" || pasted.trim() === "") return;
    const { flowId, authUrl } = phase;
    setMessage(null);
    setPhase({ kind: "completing", flowId, authUrl });
    const { ok, data } = await postJson("/api/hermes/aide/login", { action: "complete", flowId, callbackUrl: pasted.trim() });
    if (!ok) {
      // 貼り付け違いは同じ流れでやり直せないことがある（stateは1回きり）。ログインからやり直してもらう
      setPhase({ kind: "idle" });
      setMessage({ text: failureText(data), error: true });
      return;
    }
    finish(data);
  }

  const buttonClass =
    "rounded-md border border-current px-2 py-0.5 disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <div role="alert" className="border-b border-border bg-red-50 px-4 py-1.5 text-xs text-red-800 lg:px-7 dark:bg-red-950 dark:text-red-300">
      <p>
        AIDEの道具が読み込まれていません。予定・タスクなどは確認できず、天気はウェブ検索での答えになります。
        {loginRequired
          ? " AIDEのログインが切れています。「AIDEに再ログイン」から入り直してください。"
          : " 「再接続する」で張り直せます。直らないときはAIDEが止まっている可能性があります。"}
      </p>

      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        {loginRequired ? (
          <button type="button" onClick={() => void startLogin()} disabled={working} className={buttonClass}>
            {phase.kind === "starting" ? "準備しています…" : phase.kind === "awaiting" ? "ログインをやり直す" : "AIDEに再ログイン"}
          </button>
        ) : (
          <button type="button" onClick={() => void reconnect()} disabled={working} className={buttonClass}>
            {phase.kind === "reconnecting" ? "再接続しています…" : "再接続する"}
          </button>
        )}
        {phase.kind === "awaiting" && (
          <button type="button" onClick={() => void cancelLogin()} className={buttonClass}>
            取り消す
          </button>
        )}
      </div>

      {(phase.kind === "awaiting" || phase.kind === "completing") && (
        <div className="mt-2 flex flex-col gap-1.5 rounded-md border border-current/30 p-2">
          <ol className="list-decimal space-y-0.5 pl-4">
            <li>
              <a href={phase.authUrl} target="_blank" rel="noopener noreferrer" className="font-medium underline">
                AIDEのログイン画面を開く ↗
              </a>
              でログインし、許可します（5分以内）。
            </li>
            <li>
              「このページを開けません」などの画面になったら、アドレス欄のURL（<code>http://127.0.0.1:</code>
              で始まる）をコピーします。
            </li>
            <li>下の欄に貼り付けて「ログインを完了」を押します。</li>
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              value={pasted}
              onChange={(event) => setPasted(event.target.value)}
              placeholder="http://127.0.0.1:…/callback?code=…"
              aria-label="ログイン後に移った先のURL"
              disabled={phase.kind === "completing"}
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-base text-foreground placeholder:text-xs"
            />
            <button
              type="button"
              onClick={() => void completeLogin()}
              disabled={phase.kind === "completing" || pasted.trim() === ""}
              className={buttonClass}
            >
              {phase.kind === "completing" ? "確認しています…" : "ログインを完了"}
            </button>
          </div>
        </div>
      )}

      {message && (
        <p role="status" className={`mt-1.5 ${message.error ? "font-medium" : ""}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
