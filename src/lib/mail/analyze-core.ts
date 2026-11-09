import { SECRETARY_INTRO } from "@/lib/persona";

import { BODY_LIMIT, FROM_LIMIT, SUBJECT_LIMIT, SUGGEST_EXAMPLE, SUGGEST_KIND_RULES, SUGGEST_RULES, parseSuggestReply, type SuggestResult } from "@/lib/mail/suggest-core";
import { SUMMARY_RULES, parseSummaryReply, type MailSummary } from "@/lib/mail/summary-core";
import { flattenText } from "@/lib/mail/triage-core";
import { WITHDRAWAL_EXAMPLE, WITHDRAWAL_RULES, parseWithdrawalReply, type Withdrawal } from "@/lib/mail/withdrawal-core";

/**
 * メールのAI分析（#766）のうち、DB・ネットワークに触れない部分。`test/mail-analyze.test.ts` が固定する。
 *
 * 開いたメールの本文をCodexへ1回だけ読ませ、要約（#717）と処理の提案（#689）を同時に作らせる。
 * 以前は2つのボタンで別々に呼んでいた。自動で走らせるので、サブスク枠の消費を1回に抑える。
 * 本文はデータとして読ませ、返答は要約・提案それぞれの既存の検証（`parseSummaryReply()`・`parseSuggestReply()`）に通す。
 */

export type MailAnalysis = { summary: MailSummary; suggest: SuggestResult; /** 引き落としのお知らせのときだけ（#842）。残高の判定は毎回別に行い、ここには持たない。 */ withdrawal: Withdrawal | null };

const bullets = (rules: readonly string[]) => rules.map((rule) => `- ${rule}`).join("\n");

export function buildAnalyzePrompt(input: { from: string; subject: string; body: string; receivedDate: string | null; today: string }): string {
  const mail = JSON.stringify({
    from: flattenText(input.from, FROM_LIMIT),
    subject: flattenText(input.subject, SUBJECT_LIMIT),
    receivedDate: input.receivedDate,
    body: flattenText(input.body, BODY_LIMIT),
  });
  return [
    `${SECRETARY_INTRO}利用者が開いた1通のメールを読み、(1) あとで読み返さなくても内容が分かる要約と、(2) 利用者が次にするとよい処理の提案を作ってください。今日は${input.today}（日本時間）です。`,
    `要約の決まりごと:\n${bullets(SUMMARY_RULES)}`,
    `処理の種類:\n${bullets(SUGGEST_KIND_RULES)}`,
    `提案の決まりごと:\n${bullets(SUGGEST_RULES)}`,
    `引き落としの読み取り（#842）:\n${bullets(WITHDRAWAL_RULES)}`,
    `メール:\n${mail}`,
    `出力の形（1つのJSONオブジェクト）:\n${JSON.stringify({ summary: "要約", points: ["要点1", "要点2"], ...SUGGEST_EXAMPLE, ...WITHDRAWAL_EXAMPLE })}`,
  ].join("\n\n");
}

/** 返答を読む。要約が読めなければnull（提案だけの返答は受け付けない）。提案の壊れた候補は落とす。 */
export function parseAnalyzeReply(answer: string): MailAnalysis | null {
  const summary = parseSummaryReply(answer);
  if (!summary) return null;
  const suggest = parseSuggestReply(answer) ?? { recommended: null, suggestions: [] };
  return { summary, suggest, withdrawal: parseWithdrawalReply(answer) };
}

/** 結果を覚えておく時間（プロセス内のメモリだけ。DBには保存しない）。 */
export const ANALYSIS_TTL_MS = 30 * 60 * 1000;
/** 覚えておく件数の上限（古いものから捨てる）。 */
export const ANALYSIS_CACHE_MAX = 100;

/** 記憶の鍵。利用者ごとに分ける（同じメールIDでも持ち主の違う結果を返さない）。 */
export function analysisCacheKey(userId: string, messageId: string): string {
  return `${userId}\u0000${messageId}`;
}

export type CacheEntry<T> = { at: number; value: T };

/** 期限内の値だけ返す。期限切れはnull。 */
export function freshValue<T>(entry: CacheEntry<T> | undefined, now: number, ttl = ANALYSIS_TTL_MS): T | null {
  if (!entry) return null;
  return now - entry.at < ttl ? entry.value : null;
}

/** 入れたうえで、期限切れと上限超え（古い順）を捨てる。`Map` は入れた順に並ぶので、入れ直すと末尾へ移す。 */
export function putCache<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, now: number, max = ANALYSIS_CACHE_MAX, ttl = ANALYSIS_TTL_MS): void {
  cache.delete(key);
  cache.set(key, { at: now, value });
  for (const [k, entry] of cache) {
    if (cache.size <= max && now - entry.at < ttl) break;
    cache.delete(k);
  }
}
