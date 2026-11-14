import { modelFor } from "@/lib/chat-model-server";
import { runCodexRecorded } from "@/lib/codex-run";
import { jstDayKey } from "@/lib/day-key";

import { getMail, type MailUser } from "@/lib/mail/aide-client";
import { getStoredAnalysis, saveAnalysis, storedAnalysisIds } from "@/lib/mail/analysis-store";
import { acquireMailCodex, currentMailCodex } from "@/lib/mail/codex-lock";
import { analysisCacheKey, buildAnalyzePrompt, freshValue, parseAnalyzeReply, putCache, type CacheEntry, type MailAnalysis } from "@/lib/mail/analyze-core";
import type { MailFailureKind } from "@/lib/mail/contract";
import { plainBody, withReceivedDate } from "@/lib/mail/suggest-core";
import { checkWithdrawal } from "@/lib/mail/withdrawal";
import type { BalanceCheck } from "@/lib/mail/withdrawal-core";

/**
 * メールのAI分析（#766）。**サーバー専用。** メールを開いたときに画面が自動で呼び、要約と提案を1回のCodexで作る。
 *
 * - **先に `getMail()` で持ち主を照合する**（#683）。覚えた結果を返すときも毎回照合する（照合の結果は持ち回さない）
 * - 結果は利用者×メールIDで30分プロセス内のメモリに持ち、DBにも保存する（#883。アーカイブするまで残す。`analysis-store.ts`）。
 *   読む順は メモリ→DB→Codex。`refresh` で取り直す（DBも上書き）。受信時の先回りは `prefetchAnalyses()`
 * - Codexは利用者ごとに同時1件（指示 #784 と共有の排他。`codex-lock.ts`）。同じメールの分析の要求が重なったら走っている1回の結果を共有する
 *   （共有するのは分析どうしだけ。指示とは共有しない）
 */

const ANALYZE_TIMEOUT_MS = 150_000;

const cache = new Map<string, CacheEntry<MailAnalysis>>();
/** 走っている分析（利用者ごとに1件）。 */
const running = new Map<string, { key: string; promise: Promise<AnalyzeOutcome> }>();

export type AnalyzeOutcome =
  | { ok: true; result: MailAnalysis; cached: boolean }
  | { ok: false; kind: MailFailureKind | "busy" | "failed"; message: string | null };

export async function analyzeMail(user: MailUser, messageId: string, options: { refresh?: boolean } = {}): Promise<AnalyzeOutcome> {
  const key = analysisCacheKey(user.id, messageId);
  const current = running.get(user.id);
  if (current?.key === key) return current.promise;
  const release = acquireMailCodex(user.id, { kind: "analyze", key });
  if (!release) {
    const summarizing = currentMailCodex(user.id)?.kind === "list_summary";
    return {
      ok: false,
      kind: "busy",
      message: summarizing
        ? "一覧の要約を作っています。少し待ってください。"
        : current
          ? "別のメールを分析しています。少し待ってください。"
          : "指示への返事を作っています。少し待ってください。",
    };
  }

  const promise = run(user, messageId, key, options.refresh === true);
  running.set(user.id, { key, promise });
  try {
    return await promise;
  } finally {
    if (running.get(user.id)?.promise === promise) running.delete(user.id);
    release();
  }
}

/** 購入日が無い家計簿の提案を受信日で補う（#903）。記憶・保存には補う前の値を持つ。 */
function withReceived(analysis: MailAnalysis, receivedAt: number | null): MailAnalysis {
  return { ...analysis, suggest: withReceivedDate(analysis.suggest, receivedAt) };
}

async function run(user: MailUser, messageId: string, key: string, refresh: boolean): Promise<AnalyzeOutcome> {
  try {
    const mail = await getMail(user, messageId);
    if (!mail.ok) {
      cache.delete(key);
      return mail;
    }
    if (!refresh) {
      const hit = freshValue(cache.get(key), Date.now());
      if (hit) return { ok: true, result: withReceived(hit, mail.value.message.receivedAt), cached: true };
      const stored = await getStoredAnalysis(user.id, messageId).catch(() => null);
      if (stored) {
        putCache(cache, key, stored, Date.now());
        return { ok: true, result: withReceived(stored, mail.value.message.receivedAt), cached: true };
      }
    }
    const { message } = mail.value;
    const now = new Date();
    const startedAt = now.getTime();
    const result = await runCodexRecorded({
      userId: user.id,
      feature: "mail_suggest",
      label: "メールの分析",
      model: await modelFor(user.id, "mail_suggest"),
      prompt: buildAnalyzePrompt({
        from: message.from,
        subject: message.subject,
        body: plainBody(message.text, message.html),
        receivedDate: message.receivedAt ? jstDayKey(new Date(message.receivedAt)) : null,
        today: jstDayKey(now),
      }),
      timeoutMs: ANALYZE_TIMEOUT_MS,
    });
    const reply = result.messages.at(-1) ?? result.text;
    const parsed = parseAnalyzeReply(reply);
    if (!parsed) {
      console.error("[aide-bot] メールの分析の返答を読めなかった");
      return { ok: false, kind: "failed", message: "分析の返答を読めませんでした。もう一度試してください。" };
    }
    putCache(cache, key, parsed, Date.now());
    // 保存の失敗は本筋を止めない（開き直せば作り直すだけ）
    await saveAnalysis(user.id, messageId, reply, startedAt).catch((error: unknown) =>
      console.warn("[aide-bot] メールの分析の保存に失敗した", error instanceof Error ? error.message : error),
    );
    return { ok: true, result: withReceived(parsed, message.receivedAt), cached: false };
  } catch (error) {
    console.error("[aide-bot] メールの分析に失敗した", error instanceof Error ? error.message : error);
    return { ok: false, kind: "failed", message: "分析できませんでした。もう一度試してください。" };
  }
}

export type BalanceOutcome =
  | { ok: true; check: BalanceCheck | null }
  | { ok: false; kind: MailFailureKind | "no_analysis"; message: string | null };

/**
 * 残高だけを取り直す（#842）。Codexは走らせない。**先に `getMail()` で持ち主を照合する**。
 * 引き落としの読み取りは分析の記憶から取る（記憶が無い・期限切れなら `no_analysis`＝分析のやり直しを促す）。
 */
export async function recheckBalance(user: MailUser, messageId: string, pickedAccount?: string): Promise<BalanceOutcome> {
  const mail = await getMail(user, messageId);
  if (!mail.ok) return mail;
  const hit = freshValue(cache.get(analysisCacheKey(user.id, messageId)), Date.now());
  if (!hit) return { ok: false, kind: "no_analysis", message: "分析の結果が残っていません。分析し直してください。" };
  return { ok: true, check: hit.withdrawal ? await checkWithdrawal(user.id, hit.withdrawal, new Date(), pickedAccount) : null };
}

/** 先回りで分析するメールの上限（1回の新着確認あたり）。 */
export const PREFETCH_LIMIT = 50;
const PREFETCH_BUSY_WAIT_MS = 10_000;
const PREFETCH_BUSY_RETRIES = 12;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 受信時の先回りの分析（#883）。保存済みのメールは飛ばし、残りを1通ずつ `analyzeMail()` で作って保存する。
 * 排他は1通ごとに解放されるので、利用者が開いた分析・指示が割り込める。排他が空かなければ短く待ち、
 * 待ちきれなければ残りは諦める（開いたときに作る）。失敗は握りつぶしてログだけ。
 */
export async function prefetchAnalysesSafely(user: MailUser, messageIds: string[]): Promise<void> {
  // 利用者ごとに1本だけ走らせる（一覧を開くたびに呼ばれるため。#895）。走っている間に来た分は待ち行列へ足す
  const queue = prefetchQueues.get(user.id);
  if (queue) {
    for (const id of messageIds) queue.add(id);
    return;
  }
  const pending = new Set(messageIds);
  prefetchQueues.set(user.id, pending);
  try {
    while (pending.size > 0) {
      const batch = [...pending].slice(0, PREFETCH_LIMIT);
      for (const id of batch) pending.delete(id);
      if (!(await prefetchBatch(user, batch))) pending.clear();
    }
  } finally {
    prefetchQueues.delete(user.id);
  }
}

const prefetchQueues = new Map<string, Set<string>>();

/** 1回ぶんの先回り。続けてよければtrue、譲って打ち切ったらfalse。 */
async function prefetchBatch(user: MailUser, messageIds: string[]): Promise<boolean> {
  try {
    const ids = [...new Set(messageIds)];
    const stored = await storedAnalysisIds(user.id, ids);
    for (const id of ids) {
      if (stored.has(id)) continue;
      let outcome = await analyzeMail(user, id);
      for (let i = 0; !outcome.ok && outcome.kind === "busy" && i < PREFETCH_BUSY_RETRIES; i++) {
        // 利用者の操作（分析・指示・学習）が走っているなら譲って打ち切る。待つのは一覧の要約が走っているときだけ
        const hold = currentMailCodex(user.id);
        if (hold && hold.kind !== "list_summary") return false;
        await sleep(PREFETCH_BUSY_WAIT_MS);
        outcome = await analyzeMail(user, id);
      }
      if (!outcome.ok && outcome.kind === "busy") return false;
      if (!outcome.ok && outcome.kind === "not_owner") return false;
    }
    return true;
  } catch (error) {
    console.error("[aide-bot] メールの先回りの分析に失敗した", error instanceof Error ? error.message : error);
    return false;
  }
}
