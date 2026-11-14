import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildAnalyzePrompt, parseAnalyzeReply } from "@/lib/mail/analyze-core";
import {
  evaluateWithdrawal,
  matchAccount,
  normalizeWithdrawal,
  parseBalances,
  parseWithdrawalReply,
  shortageTask,
  withPickedAccount,
  type BalanceAccount,
  type BalanceKnown,
} from "@/lib/mail/withdrawal-core";

/** 口座引き落としの残高確認（#842）のうち、DB・ネットワークに触れない部分。 */

const NOW = new Date("2026-11-08T12:00:00+09:00");
const accounts: BalanceAccount[] = [
  { name: "三井住友銀行", amount: 128486, lastUpdatedAt: "2026-11-08T10:30:12+09:00" },
  { name: "三井住友カード VISA", amount: -184761, lastUpdatedAt: null },
  { name: "楽天銀行", amount: 500, lastUpdatedAt: "2026-11-05T10:00:00+09:00" },
  { name: "財布", amount: 1000, lastUpdatedAt: null },
];
const w = (over: Record<string, unknown> = {}) => normalizeWithdrawal({ amount: 84320, date: "2026-11-27", account: "三井住友銀行", payee: "◯◯カード", ...over })!;

describe("normalizeWithdrawal / parseWithdrawalReply", () => {
  it("額が読めなければnull（推測で埋めない）", () => {
    assert.equal(normalizeWithdrawal({ amount: 0 }), null);
    assert.equal(normalizeWithdrawal({ amount: "不明" }), null);
    assert.equal(normalizeWithdrawal(null), null);
    assert.equal(normalizeWithdrawal([]), null);
  });
  it("カンマ・円付きの文字列も読み、日付は実在するものだけ", () => {
    assert.equal(normalizeWithdrawal({ amount: "84,320円" })?.amount, 84320);
    assert.equal(normalizeWithdrawal({ amount: 1, date: "2026-02-30" })?.date, null);
    assert.equal(normalizeWithdrawal({ amount: 1, date: "2026-11-27" })?.date, "2026-11-27");
  });
  it("返答に withdrawal が無い・null なら null", () => {
    assert.equal(parseWithdrawalReply('{"summary":"x"}'), null);
    assert.equal(parseWithdrawalReply('{"withdrawal":null}'), null);
    assert.equal(parseWithdrawalReply("not json"), null);
    assert.equal(parseWithdrawalReply('前置き {"withdrawal":{"amount":500,"account":"楽天銀行"}}')?.account, "楽天銀行");
  });
});

describe("分析への組み込み", () => {
  it("プロンプトに引き落としの決まりごとと出力例を含む", () => {
    const prompt = buildAnalyzePrompt({ from: "a", subject: "b", body: "c", receivedDate: null, today: "2026-11-08" });
    assert.match(prompt, /引き落としの読み取り/);
    assert.match(prompt, /"withdrawal":\{/);
  });
  it("withdrawal の有無にかかわらず要約が読めれば分析は成り立つ", () => {
    const base = { summary: "要約", points: [], recommended: null, suggestions: [] };
    assert.equal(parseAnalyzeReply(JSON.stringify(base))?.withdrawal, null);
    assert.equal(parseAnalyzeReply(JSON.stringify({ ...base, withdrawal: { amount: 100 } }))?.withdrawal?.amount, 100);
  });
});

describe("parseBalances", () => {
  it("empty:true・形違いはnull", () => {
    assert.equal(parseBalances({ empty: true, balances: [] }), null);
    assert.equal(parseBalances({}), null);
  });
  it("壊れた行は落とし、lastUpdatedAt が無ければnull", () => {
    const list = parseBalances({ balances: [{ name: "A", amount: 1, lastUpdatedAt: "x" }, { name: "B", amount: 2, lastUpdatedAt: null }, { name: 3 }, null] });
    assert.deepEqual(list, [{ name: "A", amount: 1, lastUpdatedAt: "x" }, { name: "B", amount: 2, lastUpdatedAt: null }]);
  });
});

describe("matchAccount", () => {
  it("ちょうど1件だけ採る", () => {
    const hit = matchAccount(accounts, "三井住友銀行");
    assert.ok("account" in hit);
    assert.equal(hit.account.name, "三井住友銀行");
  });
  it("空白・全角半角の違いは吸収する", () => {
    assert.ok("account" in matchAccount(accounts, "三井住友 銀行"));
  });
  it("複数に合う・合わないときは選ばない", () => {
    const many = matchAccount([...accounts, { name: "三井住友銀行 別口座", amount: 1, lastUpdatedAt: null }], "三井住友銀行");
    assert.ok("candidates" in many && many.candidates.length === 2);
    assert.deepEqual(matchAccount(accounts, "ゆうちょ銀行"), { candidates: [] });
    assert.deepEqual(matchAccount(accounts, "銀"), { candidates: [] });
  });
});

describe("evaluateWithdrawal", () => {
  it("足りる／足りない", () => {
    const ok = evaluateWithdrawal(w(), accounts, NOW);
    assert.equal(ok.status, "enough");
    assert.equal((ok as BalanceKnown).after, 44166);
    const ng = evaluateWithdrawal(w({ amount: 200000 }), accounts, NOW) as BalanceKnown;
    assert.equal(ng.status, "short");
    assert.equal(ng.shortBy, 71514);
  });
  it("ちょうど同額は足りる", () => {
    assert.equal(evaluateWithdrawal(w({ amount: 128486 }), accounts, NOW).status, "enough");
  });
  it("口座名が無い・取得できない・見つからない・複数は unknown", () => {
    assert.equal(evaluateWithdrawal(w({ account: null }), accounts, NOW).status, "unknown");
    assert.equal(evaluateWithdrawal(w(), null, NOW).status, "unknown");
    assert.equal(evaluateWithdrawal(w({ account: "ゆうちょ銀行" }), accounts, NOW).status, "unknown");
  });
  it("口座名が無いときは残高の一覧から選べ、選ぶと判定できる（#909）", () => {
    const check = evaluateWithdrawal(w({ account: null }), accounts, NOW);
    assert.equal(check.status, "unknown");
    const choices = check.status === "unknown" ? check.choices : undefined;
    assert.deepEqual(choices, accounts.map((a) => a.name));
    // 取得できなかったときは選ばせない
    const noData = evaluateWithdrawal(w({ account: null }), null, NOW);
    assert.equal(noData.status === "unknown" && noData.choices, undefined);
    const picked = withPickedAccount(w({ account: null }), accounts, accounts[0].name);
    assert.equal(picked.account, accounts[0].name);
    assert.notEqual(evaluateWithdrawal(picked, accounts, NOW).status, "unknown");
    // 一覧に無い値は無視する
    assert.equal(withPickedAccount(w({ account: null }), accounts, "どこかの口座").account, null);
    assert.equal(withPickedAccount(w({ account: null }), accounts, 123).account, null);
  });
  it("最終更新が無い・24時間超は足りるとも言わない", () => {
    const none = evaluateWithdrawal(w({ account: "財布" }), accounts, NOW);
    assert.equal(none.status, "unknown");
    const stale = evaluateWithdrawal(w({ account: "楽天銀行", amount: 1 }), accounts, NOW);
    assert.equal(stale.status, "unknown");
    assert.match((stale as { reason: string }).reason, /古い/);
  });
});

describe("shortageTask", () => {
  it("期限は引き落とし日の前日、日付が無ければ無し", () => {
    const ng = evaluateWithdrawal(w({ amount: 200000 }), accounts, NOW) as BalanceKnown;
    const task = shortageTask(ng);
    assert.equal(task.due, "2026-11-26");
    assert.match(task.title, /¥71,514/);
    assert.equal(shortageTask({ ...ng, date: null }).due, null);
  });
});
