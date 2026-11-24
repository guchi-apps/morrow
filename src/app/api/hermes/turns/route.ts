import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { hermesClient } from "@/lib/hermes/client";
import { HermesError } from "@/lib/hermes/client-core";
import { SESSION_ID_PATTERN, type BridgeEvent } from "@/lib/hermes/contract";
import { describeHermesError, RATE_LIMITED } from "@/lib/hermes/errors";
import { markNotesReported, pendingHermesNotes, recordAutoAction, ingestStreamToolStart } from "@/lib/hermes/proposals";
import { checkImageBase64, IMAGE_ONLY_TEXT, imageNotice, parseTurnImages, TURN_IMAGE_MAX_COUNT } from "@/lib/hermes/image-core";
import { buildPrompt } from "@/lib/hermes/prompt-attachment";
import { parseProposalEvent } from "@/lib/hermes/proposal-core";
import { recordHermesTurnUsage } from "@/lib/hermes/record-usage";
import type { RelayEvent } from "@/lib/hermes/stream-view";
import { isAutoWriteTool, isProposeTool, knownToolKey, resultFailed } from "@/lib/hermes/tool-labels";
import { sessionTitleFrom } from "@/lib/hermes/session-title";
import { claimHermesSession, ownsHermesSession } from "@/lib/hermes/session-owner";
import { registerTurn, releaseTurn } from "@/lib/hermes/turn-owners";
import { expireTurnLog, registerTurnLog, TurnLog } from "@/lib/hermes/turn-pump";
import { TURN_ID_HEADER } from "@/lib/hermes/turn-header";
import { streamOf } from "@/lib/hermes/turn-stream";
import { readJsonObject } from "@/lib/json-body";
import { mailContextFor } from "@/lib/mail/chat-context";
import { isPushKindEnabled } from "@/lib/push/kinds-server";
import { sendPushToUser } from "@/lib/push/subscriptions";
import { parseChatLocation } from "@/lib/weather/chat-context-core";
import { markTodayInjected, todayContextFor } from "@/lib/hermes/today-context";
import { weatherContextFor } from "@/lib/weather/chat-context";

/**
 * チャットの1ターン（#794）。ブラウザ → ここ → ブリッジ（`hermesClient().startTurn()`）のSSE中継。設計は `docs/hermes-route.md`・`docs/hermes-actions.md`。
 *
 * - ブラウザへトークンもsubpcの名前も渡さない。イベントはここで読み替えてから流す
 * - `morrow_propose_action` の呼び出しは、確認カード（`HermesProposal`）を保存して `proposal` イベントに置き換える
 * - 取り消せる書き込みの `tool.complete` は、道具名と成否だけを記録する（引数・結果の本文は残さない）
 * - **画面の接続が切れてもターンは続く**（#1000。溜め `turn-pump.ts` と `turns/<id>/events` で続きを受け直す）。「止める」・1ターンの上限で止まる
 * - 画面を見ていない間に終わった・質問（`clarify`）が来たときは「チャットの返答」（`hermes-reply`）を通知する（#1150）
 * - 最初のイベントは `turn`（ブリッジの契約）。レスポンス前に受けてidを `x-hermes-turn-id` で渡す（#1005）
 * - 使用量はターンの終わりに1行（`recordHermesTurnUsage()`。#737）
 */

export const dynamic = "force-dynamic";
/** ブリッジの1ターン上限（30分。#1150）＋余裕。 */
export const maxDuration = 1860;

const MAX_TEXT = 4000;
const MIN_INTERVAL_MS = 3000;
const lastStarts = new Map<string, number>();

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const body = await readJsonObject(request);
  // 添付画像（#1157）。検証して渡すだけで、DB・ログには残さない。形が違う・大きすぎるときは理由を返す
  const images = parseTurnImages(body?.images);
  if (!images) {
    const list = Array.isArray(body?.images) ? (body.images as { data?: unknown }[]) : [];
    const reason =
      list.length > TURN_IMAGE_MAX_COUNT
        ? `画像は${TURN_IMAGE_MAX_COUNT}枚までです。`
        : (list.map((item) => checkImageBase64(item?.data)).find((check) => !check.ok) as { reason: string } | undefined)?.reason ?? "画像を読み取れませんでした。";
    return NextResponse.json({ error: reason, kind: "invalid" }, { status: 400 });
  }
  // 画像だけを送ったときの既定の指示
  const text = typeof body?.text === "string" && body.text.trim() !== "" ? body.text.trim() : images.length > 0 ? IMAGE_ONLY_TEXT : "";
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
  // 予定・タスクなど今日の状態を聞く指示なら、取得済みの値を添える（#1149。同じ会話・同じ日は一度だけ。失敗してもターンは止めない）
  const todayContext = await todayContextFor(user.id, continuing, text);
  const prompt = buildPrompt(
    [notes.text, mailContext?.prompt, weatherContext?.prompt, todayContext?.prompt, images.length > 0 ? imageNotice(images.length) : null],
    text,
  );

  let events: AsyncGenerator<BridgeEvent>;
  try {
    events = await (await hermesClient()).startTurn({
      ...(continuing ? { sessionId: continuing } : { ...(sessionTitleFrom(text) ? { title: sessionTitleFrom(text) } : {}) }),
      text: prompt,
      ...(images.length > 0 ? { images } : {}),
    });
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
  if (todayContext) log.push({ type: "notice", data: { text: todayContext.label } });

  // 最初の `turn` イベントをレスポンスより前に受け、ターンIDをヘッダーで渡す（#1005）。
  // 本文を読み始める前の「止める」・画面離脱でも、画面がinterruptと再接続に使うidを持てる
  let turnId: string | null = null;
  let sessionIdOfTurn = continuing ?? "";
  let rest: AsyncGenerator<BridgeEvent> = events;
  try {
    const first = await events.next();
    if (!first.done && first.value.type === "turn") {
      const turn = first.value;
      turnId = turn.data.turnId;
      sessionIdOfTurn = turn.data.sessionId;
      // 始まったセッションを利用者へ結びつける（#937）。DBの失敗で結べない回は後の継続が新規会話になるだけで、ターンは止めない
      const claimed = await claimHermesSession(user.id, sessionIdOfTurn).catch((error) => {
        console.error("[aide-bot] Hermesセッションの持ち主を記録できなかった", error instanceof Error ? error.message : error);
        return null;
      });
      if (claimed === false) {
        // すでに別の利用者のセッション。idをブラウザへ渡さず、ターンも続けない
        console.error("[aide-bot] 別の利用者のHermesセッションidが返った");
        await (await hermesClient()).interrupt(turn.data.turnId).catch(() => {});
        void events.return(undefined).catch(() => {});
        lastStarts.delete(user.id);
        return NextResponse.json({ error: "会話を始められませんでした。もう一度お試しください。", kind: "hermes_down" }, { status: 502 });
      }
      if (todayContext) markTodayInjected(user.id, sessionIdOfTurn, todayContext.day);
      registerTurn(turnId, user.id);
      registerTurnLog(turnId, user.id, log as TurnLog<unknown>);
      log.push(turn);
      // 本文が届く前に画面が離れていた（止める・新しい会話・画面離脱）。ターンの存在を知らせる先が無いので、ここで止める
      if (request.signal.aborted) {
        try {
          await (await hermesClient()).interrupt(turnId);
        } catch {
          // 止められなくても、読み切りと後始末はpumpが行う
        }
      }
    } else if (!first.done) {
      rest = (async function* () {
        yield first.value;
        yield* events;
      })();
    }
  } catch (error) {
    console.error("[aide-bot] Hermesのターンの開始を読めなかった", error instanceof Error ? error.message : error);
    lastStarts.delete(user.id);
    return NextResponse.json({ error: "Hermesとの接続が途中で切れました。", kind: "hermes_down" }, { status: 502 });
  }
  void pumpTurn({ events: rest, log, userId: user.id, turnId, sessionId: sessionIdOfTurn });

  return new Response(streamOf(log, 0), {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
      ...(turnId ? { [TURN_ID_HEADER]: turnId } : {}),
    },
  });
}

/** ブリッジのイベントを読み、提案の保存・使用量・通知を済ませて、ブラウザ向けのイベントを溜めへ積む。 */
async function pumpTurn(options: {
  events: AsyncGenerator<BridgeEvent>;
  log: TurnLog<RelayEvent>;
  userId: string;
  /** 最初の `turn` イベントは呼び出し側で処理済み（#1005）。無ければnull。 */
  turnId: string | null;
  sessionId: string;
}): Promise<void> {
  const { events, log, userId, turnId } = options;
  const user = { id: userId };
  const currentSessionId = options.sessionId;
  let toolCount = 0;
  let proposalsCreated = 0;
  let skillsStaged = 0;
  let memoriesStaged = 0;
  /** ターンの終わり方（#1150の通知の文面）。 */
  let ending: "complete" | "interrupted" | "error" | null = null;

  try {
    for await (const event of events) {
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
        // スキルの作成・変更が保留に入った（#1154。`skills.write_approval` で `{"staged":true}` が返る）
        if (event.data.name === "skill_manage" && /"staged"\s*:\s*true/.test(typeof event.data.result === "string" ? event.data.result : JSON.stringify(event.data.result ?? ""))) {
          skillsStaged += 1;
        }
        // 記憶の追加・変更が保留に入った（#1155。`memory.write_approval` で `{"staged":true}` が返る）
        if (event.data.name === "memory" && /"staged"\s*:\s*true/.test(typeof event.data.result === "string" ? event.data.result : JSON.stringify(event.data.result ?? ""))) {
          memoriesStaged += 1;
        }
        if (isAutoWriteTool(event.data.name) && event.data.name) {
          await recordAutoAction({
            userId: user.id,
            sessionId: currentSessionId,
            tool: knownToolKey(event.data.name) ?? event.data.name,
            ok: !resultFailed(event.data.result),
          });
        }
      }

      if (event.type === "message.complete") {
        await recordHermesTurnUsage(user.id, event.data.usage);
        ending = event.data.status === "interrupted" ? "interrupted" : "complete";
      }
      if (event.type === "error") ending = "error";
      if (event.type === "reasoning.delta" || event.type === "tool.progress") continue; // 画面には出さない

      log.push(event);
      // 見ていない間に質問が来た。答える時間（既定300秒）のうちに開いてもらう
      if (event.type === "clarify" && !log.watching) await notifyReply(user.id, currentSessionId, "question");
    }
  } catch (error) {
    // ブリッジ側の失敗。画面が残っていれば（または戻れば）エラーとして届く
    console.error("[aide-bot] Hermesのストリームが途中で切れた", error instanceof Error ? error.message : error);
    log.push({ type: "error", data: { reason: "hermes_down", message: "Hermesとの接続が途中で切れました。" } });
    ending = "error";
  } finally {
    // 画面が見ていない間に終わった（閉じた・別アプリへ移った）。「止める」で終えた回は知らせない
    const unattended = !log.watching;
    if (turnId) {
      releaseTurn(turnId);
      expireTurnLog(turnId);
    }
    log.finish();
    if (proposalsCreated > 0) await notifyPending(user.id, proposalsCreated);
    if (skillsStaged > 0) await notifySkillPending(user.id, skillsStaged);
    if (memoriesStaged > 0) await notifyMemoryPending(user.id, memoriesStaged);
    if (unattended && (ending === "complete" || ending === "error")) await notifyReply(user.id, currentSessionId, ending);
  }
}

/**
 * 画面を見ていない間の返答・質問を知らせる（#1150）。押すとその会話を開く。返答の中身は載せない（配信サービスを通るため）。
 * 種類 `hermes-reply` がオフなら送らない。
 */
async function notifyReply(userId: string, sessionId: string, kind: "complete" | "error" | "question"): Promise<void> {
  try {
    if (!(await isPushKindEnabled(userId, "hermes-reply"))) return;
    const text = {
      complete: { title: "Hermesの返答が届きました", body: "チャットを開いて、結果を確かめてください。" },
      error: { title: "Hermesの実行が途中で止まりました", body: "チャットを開いて、どこまで進んだか確かめてください。" },
      question: { title: "Hermesが確認したいことがあります", body: "5分以内にチャットを開いて、選択肢から答えてください。" },
    }[kind];
    await sendPushToUser(userId, {
      ...text,
      url: sessionId && SESSION_ID_PATTERN.test(sessionId) ? `/chat?session=${encodeURIComponent(sessionId)}` : "/chat",
      tag: kind === "question" ? "hermes-question" : "hermes-reply",
    });
  } catch (error) {
    console.error("[aide-bot] Hermesの返答の通知を送れなかった", error instanceof Error ? error.message : error);
  }
}

/** スキル案の確認待ちを知らせる（1ターンにつき1回。押すとスキルの画面を開くだけ。種類がオフなら送らない）。 */
async function notifySkillPending(userId: string, count: number): Promise<void> {
  try {
    if (!(await isPushKindEnabled(userId, "hermes-skill"))) return;
    await sendPushToUser(userId, {
      title: "スキルの確認待ちがあります",
      body: count === 1 ? "Hermesが作ったスキル案が1件、確認を待っています。" : `Hermesが作ったスキル案が${count}件、確認を待っています。`,
      url: "/skills",
      tag: "hermes-skill",
    });
  } catch (error) {
    console.error("[aide-bot] スキルの確認待ちの通知を送れなかった", error instanceof Error ? error.message : error);
  }
}

/** 記憶の案の確認待ちを知らせる（1ターンにつき1回。押すと記憶の画面を開くだけ。種類がオフなら送らない）。 */
async function notifyMemoryPending(userId: string, count: number): Promise<void> {
  try {
    if (!(await isPushKindEnabled(userId, "hermes-memory"))) return;
    await sendPushToUser(userId, {
      title: "記憶の確認待ちがあります",
      body: count === 1 ? "Hermesが覚えたい内容が1件、確認を待っています。" : `Hermesが覚えたい内容が${count}件、確認を待っています。`,
      url: "/memory",
      tag: "hermes-memory",
    });
  } catch (error) {
    console.error("[aide-bot] 記憶の確認待ちの通知を送れなかった", error instanceof Error ? error.message : error);
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
