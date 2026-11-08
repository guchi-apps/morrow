import { flattenText } from "@/lib/mail/triage-core";

/**
 * メールの要約（#717）のうち、DB・ネットワークに触れない部分。`test/mail-summary.test.ts` が固定する。
 *
 * 要約（1〜2文）と要点（最大5件）の決まりごとと検証。プロンプトは提案と1回にまとめて `analyze-core.ts` が組み立てる（#766）。
 * 本文はデータとして読ませ、返答は固定の形で検証する（メール内の指示には従わない）。
 */

export const SUMMARY_LIMIT = 300;
export const POINT_LIMIT = 120;
export const POINTS_MAX = 5;

export type MailSummary = { summary: string; points: string[] };

/** 要約の決まりごと（プロンプト用。#766で提案と1回にまとめた `analyze-core.ts` が組み立てる）。 */
export const SUMMARY_RULES: readonly string[] = [
  `summary は、このメールが何の連絡かを日本語で1〜2文（${SUMMARY_LIMIT}文字以内）`,
  `points は、利用者が知っておくべき要点（金額・日付・期限・やるべきこと）の箇条書き。多くても${POINTS_MAX}件、各${POINT_LIMIT}文字以内。要点が無ければ空配列`,
  "本文に書かれていないことは書かない。推測で埋めない",
];

/** 返答から要約を読む。形が違う・要約が空ならnull（要点だけの返答は受け付けない）。 */
export function parseSummaryReply(answer: string): MailSummary | null {
  const start = answer.indexOf("{");
  const end = answer.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(answer.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const { summary, points } = raw as Record<string, unknown>;
  if (typeof summary !== "string") return null;
  const flat = flattenText(summary, SUMMARY_LIMIT);
  if (flat === "") return null;
  const list = Array.isArray(points)
    ? points
        .filter((point): point is string => typeof point === "string")
        .map((point) => flattenText(point, POINT_LIMIT))
        .filter((point) => point !== "")
        .slice(0, POINTS_MAX)
    : [];
  return { summary: flat, points: list };
}
