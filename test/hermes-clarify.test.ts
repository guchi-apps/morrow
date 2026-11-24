import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseClarifyQuestions, toHermesClarifyAnswers, type ClarifyQuestion } from "@/lib/hermes/contract";
import {
  answerClarify,
  applyEvent,
  clarifyQuestionsOf,
  endTurn,
  initialChatState,
  startTurn,
  type ChatState,
  type RelayEvent,
} from "@/lib/hermes/stream-view";
import { TurnLog } from "@/lib/hermes/turn-pump";
import { PUSH_KIND_INFO, PUSH_KINDS } from "@/lib/push/kinds";

/** 選択肢つきの質問（clarify）のカードと、画面を見ていない間の通知（#1150）。 */

const QUESTIONS: ClarifyQuestion[] = [
  { qid: "q0", question: "どの予定ですか？", choices: ["10時の会議", "15時の会議"], multiSelect: false },
  { qid: "q1", question: "通知先は？", choices: ["メール", "Push"], multiSelect: true },
  { qid: "q2", question: "補足は？", choices: null, multiSelect: false },
];

function run(events: RelayEvent[], from: ChatState = startTurn(initialChatState, "会議を動かして")): ChatState {
  return events.reduce(applyEvent, from);
}

describe("Hermesの質問の読み取り", () => {
  it("Hermesの形（multi_select）を読み、形の違う質問・空の選択肢は落とす", () => {
    const parsed = parseClarifyQuestions([
      { qid: "q0", question: " どれ？ ", choices: ["A", "", "B"], multi_select: true },
      { qid: "q1", question: "", choices: ["A"] },
      { question: "idが無い" },
      { qid: "../x", question: "変なid" },
      { qid: "q4", question: "自由入力", choices: [], multi_select: true },
    ]);
    assert.deepEqual(parsed, [
      { qid: "q0", question: "どれ？", choices: ["A", "B"], multiSelect: true },
      { qid: "q4", question: "自由入力", choices: null, multiSelect: false },
    ]);
    assert.deepEqual(parseClarifyQuestions("x"), []);
  });

  it("回答は選択肢・自由入力・スキップだけを通し、複数選択はラベルのJSON配列にする", () => {
    assert.deepEqual(toHermesClarifyAnswers(QUESTIONS, { q0: "15時の会議", q1: ["Push"], q2: " 急ぎ " }), {
      q0: "15時の会議",
      q1: JSON.stringify(["Push"]),
      q2: "急ぎ",
    });
    // 答えの無い質問・空の複数選択はスキップ
    assert.deepEqual(toHermesClarifyAnswers(QUESTIONS, { q1: [] }), { q0: null, q1: null, q2: null });
    for (const bad of [
      { q0: "9時の会議" },
      { q0: ["10時の会議"] },
      { q1: ["Push", "Push"] },
      { q1: ["FAX"] },
      { q2: "" },
      { q2: "x".repeat(1001) },
      { q9: "x" },
      null,
      [],
    ]) {
      assert.equal(toHermesClarifyAnswers(QUESTIONS, bad), null, JSON.stringify(bad));
    }
  });
});

describe("画面の質問カード", () => {
  const clarify: RelayEvent = { type: "clarify", data: { requestId: "srq-1", questions: QUESTIONS } };

  it("質問は回答待ちのカードになり、答えたら答えた印が付く", () => {
    const state = run([clarify]);
    const item = state.items.at(-1);
    assert.ok(item?.kind === "clarify" && item.status === "waiting" && item.requestId === "srq-1");
    const answered = answerClarify(state, "srq-1", { q0: "10時の会議" });
    const done = answered.items.at(-1);
    assert.ok(done?.kind === "clarify" && done.status === "answered");
    assert.deepEqual(done.answers, { q0: "10時の会議" });
    // 2回目は変えない
    assert.equal(answerClarify(answered, "srq-1", { q0: "15時の会議" }), answered);
  });

  it("期限切れ・ターンの終わりで答えられない印にする", () => {
    const closed = run([clarify, { type: "clarify.closed", data: { requestId: "srq-1", reason: "timeout" } }]).items.at(-1);
    assert.ok(closed?.kind === "clarify" && closed.status === "closed");
    const ended = endTurn(run([clarify])).items.at(-1);
    assert.ok(ended?.kind === "clarify" && ended.status === "closed");
  });

  it("古いブリッジの質問（requestIdが無い）は質問文だけを出す", () => {
    const old = { type: "clarify", data: { questions: [{ question: "どちら？" }] } } as unknown as RelayEvent;
    const item = run([old]).items.at(-1);
    assert.ok(item?.kind === "clarify" && item.requestId === null && item.status === "closed");
    assert.equal(item.text, "どちら？");
  });

  it("回答の検証用に、溜めから開いている質問を探す（閉じたものは返さない）", () => {
    assert.deepEqual(clarifyQuestionsOf([clarify], "srq-1"), QUESTIONS);
    assert.equal(clarifyQuestionsOf([clarify], "srq-2"), null);
    assert.equal(clarifyQuestionsOf([clarify, { type: "clarify.closed", data: { requestId: "srq-1", reason: "timeout" } }], "srq-1"), null);
  });
});

describe("画面を見ていない間の通知", () => {
  it("溜めの購読者の有無で、画面が見ているかを判定する", () => {
    const log = new TurnLog<number>();
    assert.equal(log.watching, false);
    const stop = log.subscribe(0, () => {}, () => {});
    assert.equal(log.watching, true);
    stop();
    assert.equal(log.watching, false);
  });

  it("通知の種類 hermes-reply があり、見本はチャットを開く", () => {
    assert.ok(PUSH_KINDS.includes("hermes-reply"));
    assert.equal(PUSH_KIND_INFO["hermes-reply"].sample.url, "/chat");
  });
});
