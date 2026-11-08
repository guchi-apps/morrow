import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeHermesError } from "@/lib/hermes/errors";
import type { ProposalView } from "@/lib/hermes/proposal-core";
import { parseSseBlockOf } from "@/lib/hermes/sse";
import {
  addNotice,
  answerApproval,
  applyEvent,
  clarifyText,
  endTurn,
  initialChatState,
  RELAY_EVENT_TYPES,
  startTurn,
  type ChatState,
  type RelayEvent,
} from "@/lib/hermes/stream-view";
import { argLines, isAutoWriteTool, isProposeTool, knownToolKey, resultFailed, toolHint, toolLabel } from "@/lib/hermes/tool-labels";

/** チャット画面の状態の畳み込み・道具の表示名・失敗の読み替え（#794）。 */

function run(events: RelayEvent[], from: ChatState = startTurn(initialChatState, "こんにちは")): ChatState {
  return events.reduce(applyEvent, from);
}

const proposal = { id: "p1", label: "家計簿の登録", status: "pending" } as unknown as ProposalView;

describe("イベントの畳み込み", () => {
  it("turnでセッションとターンのidを持ち、deltaを1つの吹き出しへ繋ぐ", () => {
    const state = run([
      { type: "turn", data: { turnId: "t1", sessionId: "s1" } },
      { type: "message.delta", data: { text: "こん" } },
      { type: "message.delta", data: { text: "にちは" } },
    ]);
    assert.equal(state.turnId, "t1");
    assert.equal(state.sessionId, "s1");
    assert.equal(state.running, true);
    const last = state.items.at(-1);
    assert.deepEqual(last && last.kind === "assistant" ? [last.text, last.done] : null, ["こんにちは", false]);
  });

  it("message.completeの全文で吹き出しを確定し、実行中を終える", () => {
    const state = run([
      { type: "message.delta", data: { text: "こん" } },
      { type: "message.complete", data: { text: "こんにちは。", status: "complete" } },
    ]);
    assert.equal(state.running, false);
    assert.equal(state.turnId, null);
    const assistants = state.items.filter((i) => i.kind === "assistant");
    assert.equal(assistants.length, 1);
    assert.equal(assistants[0].kind === "assistant" && assistants[0].text, "こんにちは。");
  });

  it("Hermes組み込みの道具は日本語名と手掛かりで出す（#814）", () => {
    assert.equal(toolLabel("web_search"), "ウェブを検索");
    assert.equal(toolHint("web_search", { query: "高槻市 天気" }), "「高槻市 天気」");
    assert.equal(toolLabel("mcp_x_web_extract"), "ページを読み込む");
    // URLのパス・クエリは出さずドメインだけ
    assert.equal(toolHint("web_extract", { urls: ["https://tenki.jp/forecast/6/30?q=secret"] }), "tenki.jp");
    assert.equal(toolHint("tool_search", { queries: ["gmail search", "x"] }), "「gmail search」");
    assert.equal(toolLabel("tool_describe"), "道具の使い方を確認");
    assert.equal(isAutoWriteTool("web_search"), false);
  });

  it("tool_callの中継は呼び先の名前で表示する。知らない道具は名前を添える", () => {
    const args = JSON.stringify({ calls: [{ name: "desktop_project", arguments: { action: "list" } }] });
    assert.equal(toolLabel("tool_call", args), "プロジェクトを確認");
    assert.equal(toolLabel("tool_call", { calls: [{ name: "aide_weather" }] }), "天気の確認");
    assert.equal(toolLabel("something_new"), "その他の操作");
    assert.equal(toolHint("something_new", {}), "something_new");
    assert.equal(toolHint("aide_schedule", {}), null);
    const state = run([{ type: "tool.start", data: { name: "web_search", args: { query: "天気" } } }]);
    const item = state.items[1];
    assert.ok(item.kind === "tool" && item.label === "ウェブを検索" && item.hint === "「天気」");
  });

  it("途中の本文が無い回は、全文を1つの吹き出しにする。あれば足さない", () => {
    const none = run([{ type: "message.complete", data: { text: "終わりました" } }]);
    assert.equal(none.items.filter((i) => i.kind === "assistant").length, 1);
    const some = run([
      { type: "message.delta", data: { text: "確認します" } },
      { type: "tool.start", data: { name: "aide_schedule", args: {} } },
      { type: "tool.complete", data: { name: "aide_schedule" } },
      { type: "message.complete", data: { text: "確認します予定は空です" } },
    ]);
    assert.equal(some.items.filter((i) => i.kind === "assistant").length, 1);
  });

  it("道具は実行中→完了。取り消せる書き込みは引数の行を持ち、読み取りは持たない", () => {
    const started = run([
      { type: "tool.start", data: { name: "mcp_aide_aide_create_event", args: { title: "歯医者", date: "2026-11-09", idempotencyKey: "k" } } },
      { type: "tool.start", data: { name: "aide_schedule", args: { days: 3 } } },
    ]);
    const [, write, read] = started.items;
    assert.ok(write.kind === "tool" && write.auto && write.status === "running");
    assert.deepEqual(write.kind === "tool" && write.lines, [
      { label: "件名", value: "歯医者" },
      { label: "日付", value: "2026-11-09" },
    ]);
    assert.ok(read.kind === "tool" && !read.auto && read.lines.length === 0);

    const done = applyEvent(started, { type: "tool.complete", data: { name: "mcp_aide_aide_create_event", result: { ok: true } } });
    assert.ok(done.items[1].kind === "tool" && done.items[1].status === "done");
    assert.ok(done.items[2].kind === "tool" && done.items[2].status === "running");
    const failed = applyEvent(done, { type: "tool.complete", data: { name: "aide_schedule", result: { error: "x" } } });
    assert.ok(failed.items[2].kind === "tool" && failed.items[2].status === "failed");
  });

  it("対応する実行中の道具が無いtool.completeは無視する", () => {
    const state = run([{ type: "tool.complete", data: { name: "aide_schedule" } }]);
    assert.equal(state.items.length, 1);
  });

  it("確認カードは同じ提案を二重に並べない", () => {
    const event: RelayEvent = { type: "proposal", data: { proposal } };
    assert.equal(run([event, event]).items.filter((i) => i.kind === "proposal").length, 1);
  });

  it("Hermesの承認は待ち→once/denyに変わる", () => {
    const state = run([{ type: "approval", data: { requestId: "r1", command: "ls", choices: ["once", "deny"] } }]);
    const item = state.items.at(-1);
    assert.ok(item?.kind === "approval" && item.status === "waiting");
    const answered = answerApproval(state, "r1", "once");
    const after = answered.items.at(-1);
    assert.ok(after?.kind === "approval" && after.status === "once");
  });

  it("errorはお知らせ（赤）にして実行中を終える。中断は情報として出す", () => {
    const failed = run([{ type: "error", data: { reason: "timeout", message: "上限を超えました" } }]);
    assert.equal(failed.running, false);
    const notice = failed.items.at(-1);
    assert.ok(notice?.kind === "notice" && notice.tone === "error" && notice.text === "上限を超えました");
    const interrupted = run([{ type: "message.complete", data: { text: null, status: "interrupted" } }]);
    const info = interrupted.items.at(-1);
    assert.ok(info?.kind === "notice" && info.tone === "info");
  });

  it("tool.completeを受けずに終わった道具は成功にせず結果不明にする", () => {
    const state = endTurn(run([{ type: "tool.start", data: { name: "aide_create_task", args: {} } }]));
    assert.ok(state.items[1].kind === "tool" && state.items[1].status === "unknown");
    const completed = endTurn(
      run([
        { type: "tool.start", data: { name: "aide_create_task", args: {} } },
        { type: "tool.complete", data: { name: "aide_create_task", result: "{}" } },
      ]),
    );
    assert.ok(completed.items[1].kind === "tool" && completed.items[1].status === "done");
  });

  it("endTurnは実行中の道具と生成中の吹き出しを閉じる", () => {
    const state = endTurn(run([{ type: "message.delta", data: { text: "a" } }, { type: "tool.start", data: { name: "aide_tasks", args: {} } }]));
    assert.ok(state.items.every((i) => (i.kind === "assistant" ? i.done : i.kind !== "tool" || i.status !== "running")));
  });

  it("選択肢つきの質問は質問文として出す", () => {
    assert.equal(clarifyText([{ question: "どの予定？" }]), "どの予定？");
    assert.match(clarifyText(null), /確認したい/);
    assert.equal(addNotice(initialChatState, "info", "x").items.length, 1);
  });
});

describe("ブラウザ向けSSE", () => {
  it("中継の種類（proposal）を読み、知らない種類・壊れたデータは捨てる", () => {
    const ok = parseSseBlockOf<RelayEvent>('event: proposal\ndata: {"proposal":{"id":"p1"}}', RELAY_EVENT_TYPES);
    assert.equal(ok?.type, "proposal");
    assert.equal(parseSseBlockOf('event: reasoning.delta\ndata: {"text":"x"}', RELAY_EVENT_TYPES), null);
    assert.equal(parseSseBlockOf("event: message.delta\ndata: {broken", RELAY_EVENT_TYPES), null);
    assert.equal(parseSseBlockOf(": ping", RELAY_EVENT_TYPES), null);
  });
});

describe("道具の表示名", () => {
  it("mcp_<サーバー>_の接頭辞があっても既知の名前で照合し、知らない道具は名前を見せない", () => {
    assert.equal(knownToolKey("mcp_aide_aide_schedule"), "aide_schedule");
    assert.equal(toolLabel("mcp_aide_aide_schedule"), "予定の確認");
    assert.equal(toolLabel("terminal"), "その他の操作");
    assert.equal(toolLabel(undefined), "その他の操作");
  });

  it("自動実行の書き込みと提案の道具を見分ける。取り消せない書き込みは自動に含めない", () => {
    assert.ok(isAutoWriteTool("aide_create_task"));
    assert.ok(!isAutoWriteTool("aide_delete_event"));
    assert.ok(!isAutoWriteTool("asset_manager_import_payment"));
    assert.ok(!isAutoWriteTool("aide_schedule"));
    assert.ok(isProposeTool("mcp_morrow_morrow_propose_action"));
    assert.ok(!isProposeTool("aide_create_task"));
  });

  it("引数の行は項目名のあるものだけ。JSON文字列でも読み、長い値は切る", () => {
    assert.deepEqual(argLines('{"title":"a","idempotencyKey":"k","version":2}'), [{ label: "件名", value: "a" }]);
    assert.equal(argLines("not json").length, 0);
    assert.ok(argLines({ memo: "あ".repeat(200) })[0].value.endsWith("…"));
  });

  it("結果が失敗に見えるか。形が分からなければ失敗にしない", () => {
    assert.ok(resultFailed({ isError: true }));
    assert.ok(resultFailed('{"error":"x"}'));
    assert.ok(resultFailed("Error: boom"));
    assert.ok(!resultFailed({ ok: true }));
    assert.ok(!resultFailed("done"));
    assert.ok(!resultFailed(undefined));
  });
});

describe("失敗の読み替え（#214）", () => {
  it("接続の問題は状態を変え、会話の問題は変えない", () => {
    assert.equal(describeHermesError("unreachable").connection, "unreachable");
    assert.equal(describeHermesError("hermes_down").connection, "hermes_down");
    assert.equal(describeHermesError("rejected").connection, "misconfigured");
    assert.equal(describeHermesError("not_configured").connection, "misconfigured");
    for (const kind of ["no_session", "session_busy", "bridge_busy", "turn_not_found"] as const) {
      assert.equal(describeHermesError(kind).connection, null);
    }
  });
});
