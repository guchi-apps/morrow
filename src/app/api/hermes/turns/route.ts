import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { hermesClient } from "@/lib/hermes/client";
import { HermesError } from "@/lib/hermes/client-core";
import { SESSION_ID_PATTERN, type BridgeEvent } from "@/lib/hermes/contract";
import { describeHermesError, RATE_LIMITED } from "@/lib/hermes/errors";
import { markNotesReported, pendingHermesNotes, recordAutoAction, ingestStreamToolStart } from "@/lib/hermes/proposals";
import { buildPrompt } from "@/lib/hermes/prompt-attachment";
import { parseProposalEvent } from "@/lib/hermes/proposal-core";
import { recordHermesTurnUsage } from "@/lib/hermes/record-usage";
import type { RelayEvent } from "@/lib/hermes/stream-view";
import { isAutoWriteTool, isProposeTool, knownToolKey, resultFailed } from "@/lib/hermes/tool-labels";
import { claimHermesSession, ownsHermesSession } from "@/lib/hermes/session-owner";
import { registerTurn, releaseTurn } from "@/lib/hermes/turn-owners";
import { expireTurnLog, registerTurnLog, TurnLog } from "@/lib/hermes/turn-pump";
import { streamOf } from "@/lib/hermes/turn-stream";
import { readJsonObject } from "@/lib/json-body";
import { mailContextFor } from "@/lib/mail/chat-context";
import { isPushKindEnabled } from "@/lib/push/kinds-server";
import { sendPushToUser } from "@/lib/push/subscriptions";
import { parseChatLocation } from "@/lib/weather/chat-context-core";
import { weatherContextFor } from "@/lib/weather/chat-context";

/**
 * チャットの1ターン（#794）。ブラウザ → ここ → ブリッジ（`hermesClient().startTurn()`）のSSE中継。設計は `docs/hermes-route.md`・`docs/hermes-actions.md`。
 *
 * - ブラウザへトークンもsubpcの名前も渡さない。イベントはここで読み替えてから流す
 * - `morrow_propose_action` の呼び出しは、確認カード（`HermesProposal`）を保存して `proposal` イベントに置き換える
 * - 取り消せる書き込みの `tool.complete` は、道具名と成否だけを記録する（引数・結果の本文は残さない）
 * - **画面の接続が切れてもターンは続く**（#1000。溜め `turn-pump.ts` と `turns/<id>/events` で続きを受け直す）。「止める」・1ターンの上限で止まる
 * - 使用量はターンの終わりに1行（`recordHermesTurnUsage()`。#737）
 */

export const dynamic = "force-dynamic";
/** ブリッジの1ターン上限（10分）＋余裕。 */
export const maxDuration = 660;

const MAX_TEXT = 4000;
const MIN_INTERVAL_MS = 3000;
const lastStarts = new Map<string, number>();

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const body = await readJsonObject(request);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const sessionId = body?.sessionId;
  if (
    text === "" ||
    text.length > MAX_TEXT ||
    (sessionId !== undefined && sessionId !== null && (typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId)))
  ) {
    return NextResponse.json(
      { error: text.length > MAX_TEXT ? `指示は${MAX_TEXT}文字までです。` : "指示を入力してください。", kind: "invalid" },
      { status: 400 },
    );
  }
  // 継続は、その利用者のセッションだけ（#937）。他人のもの・持ち主不明のidは新規会話として始める
  const requested = typeof sessionId === "string" ? sessionId : undefined;
  const continuing = requested && (await ownsHermesSession(user.id, requested).catch(() => false)) ? requested : undefined;

  // ターンの開始は利用者ごとに3秒に1回（#726）
  const now = Date.now();
  const last = lastStarts.get(user.id);
  if (last !== undefined && now - last < MIN_INTERVAL_MS) {
    return NextResponse.json({ error: RATE_LIMITED.message, kind: RATE_LIMITED.kind }, { status: RATE_LIMITED.status });
  }
  lastStarts.set(user.id, now);

  // 前の発言以降に実行・取り下げされた提案を、先頭に付けてHermesへ伝える（送れたら伝達済みにする）
  const notes = continuing ? await pendingHermesNotes(user.id, continuing) : { text: "", ids: [] };
  // メールに触れる指示なら、検索して該当メールを先頭へ添える（#813。失敗してもターンは止めない）
  const mailContext = await mailContextFor(user, text).catch(() => null);
  // 天気について聞く指示なら、現在地（無ければ自宅）の予報を添える（#930。失敗してもターンは止めない）
  const weatherContext = await weatherContextFor(user.id, text, parseChatLocation(body?.location));
  const prompt = buildPrompt([notes.text, mailContext?.prompt, weatherContext?.prompt], text);

  let events: AsyncGenerator<BridgeEvent>;
  try {
    events = await (await hermesClient()).startTurn({ ...(continuing ? { sessionId: continuing } : {}), text: prompt });
  } catch (error) {
    // 送れなかった指示は溜めない。画面が入力欄へ戻す（#726）
    lastStarts.delete(user.id);
    const kind = error instanceof HermesError ? error.kind : "unreachable";
    if (kind === "rejected" || kind === "not_configured") console.error(`[aide-bot] Hermesブリッジの設定に問題がある（${kind}）`);
    else if (!(error instanceof HermesError)) console.error("[aide-bot] Hermesのターンを始められなかった", error instanceof Error ? error.message : error);
    const failure = describeHermesError(kind);
    return NextResponse.json({ error: failure.message, kind: failure.kind }, { status: failure.status });
  }
  await markNotesReported(user.id, notes.ids);

  // ブリッジのストリームはブラウザの接続と無関係に読み切る（#1000）。画面が離れても（iOSで別アプリへ移るなど）ターンは続き、
  // 戻った画面は `turns/<id>/events` で続きを受ける。止めるのは「止める」と1ターンの上限だけ
  const log = new TurnLog<RelayEvent>();
  if (mailContext) log.push({ type: "notice", data: { text: mailContext.label } });
  if (weatherContext) log.push({ type: "notice", data: { text: weatherContext.label } });
  void pumpTurn({ events, log, userId: user.id, continuing });

  return new Response(streamOf(log, 0), {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

/** ブリッジのイベントを読み、提案の保存・使用量・通知を済ませて、ブラウザ向けのイベントを溜めへ積む。 */
async function pumpTurn(options: {
  events: AsyncGenerator<BridgeEvent>;
  log: TurnLog<RelayEvent>;
  userId: string;
  continuing: string | undefined;
}): Promise<void> {
  const { events, log, userId } = options;
  const user = { id: userId };
  let turnId: string | null = null;
  let currentSessionId = options.continuing ?? "";
  let toolCount = 0;
  let proposalsCreated = 0;

  try {
    for await (const event of events) {
      if (event.type === "turn") {
        turnId = event.data.turnId;
        currentSessionId = event.data.sessionId;
        // 始まったセッションを利用者へ結びつける（#937）。DBの失敗で結べない回は後の継続が新規会話になるだけで、ターンは止めない
        const claimed = await claimHermesSession(user.id, currentSessionId).catch((error) => {
          console.error("[aide-bot] Hermesセッションの持ち主を記録できなかった", error instanceof Error ? error.message : error);
          return null;
        });
        if (claimed === false) {
          // すでに別の利用者のセッション。idをブラウザへ渡さず、ターンも続けない
          console.error("[aide-bot] 別の利用者のHermesセッションidが返った");
          await (await hermesClient()).interrupt(event.data.turnId).catch(() => {});
          log.push({ type: "error", data: { reason: "hermes_down", message: "会話を始められませんでした。もう一度お試しください。" } });
          break;
        }
        registerTurn(turnId, user.id);
        registerTurnLog(turnId, user.id, log as TurnLog<unknown>);
        log.push(event);
        continue;
      }

      if (event.type === "tool.start") {
        toolCount += 1;
        if (isProposeTool(event.data.name)) {
          // 提案は確認カードにして流す。生の呼び出し（引数）はブラウザへ渡さない
          if (parseProposalEvent(event.data.name, event.data.args)) {
            try {
              const proposal = await ingestStreamToolStart({
                userId: user.id,
                sessionId: currentSessionId,
                callId: `${turnId ?? "turn"}:${toolCount}`,
                name: event.data.name,
                args: event.data.args,
              });
              if (proposal) {
                proposalsCreated += 1;
                log.push({ type: "proposal", data: { proposal } });
              }
            } catch (error) {
              console.error("[aide-bot] Hermesの提案を保存できなかった", error instanceof Error ? error.message : error);
            }
          }
          continue;
        }
      }

      if (event.type === "tool.complete") {
        if (isProposeTool(event.data.name)) continue;
        if (isAutoWriteTool(event.data.name) && event.data.name) {
          await recordAutoAction({
            userId: user.id,
            sessionId: currentSessionId,
            tool: knownToolKey(event.data.name) ?? event.data.name,
            ok: !resultFailed(event.data.result),
          });
        }
      }

      if (event.type === "message.complete") await recordHermesTurnUsage(user.id, event.data.usage);
      if (event.type === "reasoning.delta" || event.type === "tool.progress") continue; // 画面には出さない

      log.push(event);
    }
  } catch (error) {
    // ブリッジ側の失敗。画面が残っていれば（または戻れば）エラーとして届く
    console.error("[aide-bot] Hermesのストリームが途中で切れた", error instanceof Error ? error.message : error);
    log.push({ type: "error", data: { reason: "hermes_down", message: "Hermesとの接続が途中で切れました。" } });
  } finally {
    if (turnId) {
      releaseTurn(turnId);
      expireTurnLog(turnId);
    }
    log.finish();
    if (proposalsCreated > 0) await notifyPending(user.id, proposalsCreated);
  }
}

/** 確認待ちがあることを知らせる（1ターンにつき1回。押すとチャットを開くだけ。種類がオフなら送らない）。 */
async function notifyPending(userId: string, count: number): Promise<void> {
  try {
    if (!(await isPushKindEnabled(userId, "hermes-approval"))) return;
    await sendPushToUser(userId, {
      title: "確認待ちがあります",
      body: count === 1 ? "Hermesの提案が1件、確認を待っています。" : `Hermesの提案が${count}件、確認を待っています。`,
      url: "/chat",
      tag: "hermes-approval",
    });
  } catch (error) {
    console.error("[aide-bot] 確認待ちの通知を送れなかった", error instanceof Error ? error.message : error);
  }
}
