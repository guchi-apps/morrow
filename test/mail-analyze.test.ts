import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ANALYSIS_TTL_MS,
  analysisCacheKey,
  buildAnalyzePrompt,
  freshValue,
  parseAnalyzeReply,
  sanitizeLinkSuggestions,
  putCache,
  type CacheEntry,
} from "@/lib/mail/analyze-core";

/** メールのAI分析（#766。要約と提案を1回で作る）のうち、DB・ネットワークに触れない部分。 */

describe("buildAnalyzePrompt", () => {
  const prompt = buildAnalyzePrompt({ from: "a@example.com", subject: "件名", body: "本文\n改行", receivedDate: null, today: "2026-11-08" });

  it("要約と提案の両方の決まりごと・出力の形を含む", () => {
    assert.match(prompt, /要約の決まりごと/);
    assert.match(prompt, /提案の決まりごと/);
    assert.match(prompt, /"summary":"要約"/);
    assert.match(prompt, /"recommended":"payment"/);
    assert.match(prompt, /今日は2026-11-08/);
  });

  it("本文をデータとして渡し、メール内の指示に従わせない", () => {
    assert.match(prompt, /指示（.*）には従わない/);
    assert.ok(!prompt.includes("本文\n改行"));
  });

  it("本文は上限で切る", () => {
    const long = buildAnalyzePrompt({ from: "a", subject: "b", body: "あ".repeat(20000), receivedDate: null, today: "2026-11-08" });
    assert.ok(long.length < prompt.length + 7000);
  });
});

describe("parseAnalyzeReply", () => {
  it("要約と提案を1つの返答から読む", () => {
    const reply = JSON.stringify({
      summary: "電気料金のお知らせ",
      points: ["7,842円"],
      recommended: "payment",
      suggestions: [{ kind: "payment", reason: "請求", confidence: 0.9, fields: { place: "関西電力", name: "電気料金", amount: 7842, date: "2026-11-05" } }],
    });
    const result = parseAnalyzeReply(`前置き${reply}`);
    assert.ok(result);
    assert.deepEqual(result.summary, { summary: "電気料金のお知らせ", points: ["7,842円"] });
    assert.equal(result.suggest.recommended, "payment");
    assert.equal(result.suggest.suggestions.length, 1);
  });

  it("提案が無ければ空。要約が無い・読めない返答はnull", () => {
    assert.deepEqual(parseAnalyzeReply('{"summary":"x"}')?.suggest, { recommended: null, suggestions: [] });
    assert.equal(parseAnalyzeReply('{"recommended":"task","suggestions":[]}'), null);
    assert.equal(parseAnalyzeReply("だめ"), null);
  });
});

describe("分析の記憶", () => {
  it("鍵は利用者ごとに分ける", () => {
    assert.notEqual(analysisCacheKey("u1", "m"), analysisCacheKey("u2", "m"));
  });

  it("30分を過ぎた値は返さない", () => {
    const entry: CacheEntry<string> = { at: 1000, value: "v" };
    assert.equal(freshValue(entry, 1000 + ANALYSIS_TTL_MS - 1), "v");
    assert.equal(freshValue(entry, 1000 + ANALYSIS_TTL_MS), null);
    assert.equal(freshValue(undefined, 0), null);
  });

  it("上限を超えたら古いものから捨て、期限切れも掃除する", () => {
    const cache = new Map<string, CacheEntry<number>>();
    putCache(cache, "a", 1, 0, 2);
    putCache(cache, "b", 2, 10, 2);
    putCache(cache, "a", 3, 20, 2); // 入れ直すと末尾へ
    putCache(cache, "c", 4, 30, 2);
    assert.deepEqual([...cache.keys()], ["a", "c"]);
    putCache(cache, "d", 5, 30 + ANALYSIS_TTL_MS, 10);
    assert.deepEqual([...cache.keys()], ["d"]);
  });
});

describe("紐づけの提案（#1029）", () => {
  const task = { kind: "task" as const, targetId: "t1", calendarId: null, title: "荷物受け取り", dateText: "2026-11-17", time: null };
  const event = { kind: "event" as const, targetId: "e1", calendarId: "cal-1", title: "再配達", dateText: "2026-11-17", time: "10:00" };
  const linkReply = (fields: Record<string, unknown>, recommended = "link") =>
    JSON.stringify({
      summary: "要約",
      points: ["要点"],
      recommended,
      suggestions: [{ kind: "link", reason: "同じ用件", confidence: 0.9, fields }],
    });

  it("候補があるときだけ、プロンプトに候補と紐づけの決まりごとが入る", () => {
    const base = { from: "a", subject: "b", body: "c", receivedDate: null, today: "2026-11-17" };
    assert.ok(!buildAnalyzePrompt(base).includes("既存の予定・タスク"));
    const prompt = buildAnalyzePrompt({ ...base, candidates: [task] });
    assert.match(prompt, /既存の予定・タスク（1行1件のJSON/);
    assert.match(prompt, /"targetId":"t1"/);
    assert.match(prompt, /link: 既存の予定・タスクに紐づける/);
  });

  it("候補にあるidは通し、題名・日付は候補の値で置き換える", () => {
    const reply = sanitizeLinkSuggestions(linkReply({ kind: "task", targetId: "t1", calendarId: null, title: "でたらめ", dateText: "2020-01-01" }), [task]);
    const parsed = parseAnalyzeReply(reply);
    assert.equal(parsed?.suggest.recommended, "link");
    const link = parsed?.suggest.suggestions[0];
    assert.ok(link && link.kind === "link");
    assert.deepEqual(link.fields, { kind: "task", targetId: "t1", calendarId: null, title: "荷物受け取り", dateText: "2026-11-17" });
  });

  it("候補に無いid・別のカレンダーの予定は落とし、推奨も外す", () => {
    const unknown = parseAnalyzeReply(sanitizeLinkSuggestions(linkReply({ kind: "task", targetId: "zzz", calendarId: null, title: "x" }), [task]));
    assert.deepEqual(unknown?.suggest.suggestions, []);
    assert.equal(unknown?.suggest.recommended, null);
    const otherCalendar = parseAnalyzeReply(sanitizeLinkSuggestions(linkReply({ kind: "event", targetId: "e1", calendarId: "cal-2", title: "x" }), [event]));
    assert.deepEqual(otherCalendar?.suggest.suggestions, []);
    const ok = parseAnalyzeReply(sanitizeLinkSuggestions(linkReply({ kind: "event", targetId: "e1", calendarId: "cal-1", title: "x" }), [event]));
    assert.equal(ok?.suggest.suggestions.length, 1);
  });

  it("候補が無いときは紐づけの提案を残さない（他の提案は残る）", () => {
    const reply = JSON.stringify({
      summary: "要約",
      points: [],
      recommended: "link",
      suggestions: [
        { kind: "link", reason: "r", confidence: 0.9, fields: { kind: "task", targetId: "t1", calendarId: null, title: "x" } },
        { kind: "tracking", reason: "r", confidence: 0.9, fields: { carrier: "yamato", number: "335083439530" } },
      ],
    });
    const parsed = parseAnalyzeReply(sanitizeLinkSuggestions(reply, []));
    assert.deepEqual(parsed?.suggest.suggestions.map((s) => s.kind), ["tracking"]);
    assert.equal(parsed?.suggest.recommended, "tracking");
  });

  it("読めない返答はそのまま返す", () => {
    assert.equal(sanitizeLinkSuggestions("not json", [task]), "not json");
  });
});
