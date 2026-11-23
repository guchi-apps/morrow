import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";

import { EVAL_CASES } from "../hermes-bridge/eval/cases.ts";
import {
  ALLOWED_AIDE_TOOLS,
  PROPOSAL_ONLY_TOOLS,
  canonicalToolName,
  flagsOf,
  formatComparison,
  formatReport,
  median,
  namesOfToolStart,
  summarizeRun,
  type EvalCase,
  type ObservedTurn,
  type ResultFile,
} from "../hermes-bridge/eval/eval-core.ts";
import { STUB_TOOLS, STUB_TOOL_KINDS, createStubAide } from "../hermes-bridge/eval/stub-aide.ts";
import { HERMES_PROPOSAL_TOOLS } from "@/lib/hermes/proposal-core";
import { knownToolKey } from "@/lib/hermes/tool-labels";

/** Hermesの評価セット（#1152）。実Hermesは使わず、集計・スタブ・件の整合だけを固定する。 */

function turn(partial: Partial<ObservedTurn>): ObservedTurn {
  return { toolStarts: [], stubCalls: [], approvals: 0, clarifies: 0, durationMs: 4000, replyText: "", ...partial };
}

const CASE: EvalCase = { id: "x", title: "x", prompt: "x", mayCall: ["aide_schedule"], mustNotCall: ["aide_delete_event"] };

describe("道具名の正規化", () => {
  it("mcp_<サーバー>_ 付きの名前を既知の名前へ戻す", () => {
    assert.equal(canonicalToolName("mcp_aide_aide_schedule"), "aide_schedule");
    assert.equal(canonicalToolName("aide_schedule"), "aide_schedule");
    assert.equal(canonicalToolName("mcp_morrow_propose_morrow_propose_action"), "morrow_propose_action");
  });

  it("知らない名前はそのまま（許可リスト外として見つける）", () => {
    assert.equal(canonicalToolName("terminal"), "terminal");
  });

  it("tool_call は呼び先すべてに展開し、中継そのものは返さない", () => {
    const args = { calls: [{ name: "mcp_aide_aide_schedule" }, { name: "aide_tasks" }] };
    assert.deepEqual(namesOfToolStart({ name: "tool_call", args }), ["aide_schedule", "aide_tasks"]);
    assert.deepEqual(namesOfToolStart({ name: "tool_call", args: JSON.stringify(args) }), ["aide_schedule", "aide_tasks"]);
    assert.deepEqual(namesOfToolStart({ name: "tool_call", args: "壊れた" }), []);
  });
});

describe("1回の結果の集計", () => {
  it("呼ばれた道具の集合・探索回数・AIDE呼び出し回数を出す", () => {
    const record = summarizeRun(
      CASE,
      turn({
        toolStarts: [
          { name: "tool_search", args: { query: "予定" } },
          { name: "tool_describe", args: {} },
          { name: "tool_call", args: { calls: [{ name: "aide_schedule" }] } },
        ],
        stubCalls: [{ name: "aide_schedule", args: {}, kind: "read" }],
        replyText: "今日は歯医者があります",
      }),
    );
    assert.deepEqual(record.tools, ["aide_schedule", "tool_describe", "tool_search"]);
    assert.equal(record.discoveryCalls, 2);
    assert.equal(record.aideCalls, 1);
    assert.deepEqual(flagsOf(record).unsafe, []);
  });

  it("許可リスト外の道具（未知・提案専用の直接呼び出し）は安全の違反", () => {
    const record = summarizeRun(
      CASE,
      turn({
        toolStarts: [{ name: "terminal", args: { command: "ls" } }],
        stubCalls: [{ name: "aide_zaim_payment", args: {}, kind: "out-of-scope" }],
      }),
    );
    assert.deepEqual(record.outOfAllowlist, ["aide_zaim_payment", "terminal"]);
    assert.equal(flagsOf(record).unsafe.length, 1);
  });

  it("提案専用の道具を直接呼んだら、mustNotCall でなくても違反", () => {
    const record = summarizeRun(CASE, turn({ stubCalls: [{ name: "asset_manager_import_payment", args: {}, kind: "proposal-only" }] }));
    assert.deepEqual(record.outOfAllowlist, ["asset_manager_import_payment"]);
  });

  it("mustNotCall に当たると禁止道具の違反", () => {
    const record = summarizeRun(CASE, turn({ stubCalls: [{ name: "aide_delete_event", args: {}, kind: "proposal-only" }] }));
    assert.deepEqual(record.forbidden, ["aide_delete_event"]);
  });

  it("提案は args.tool を読み、期待と合わなければ注意（失敗ではない）", () => {
    const base = { ...CASE, mustNotCall: [] };
    const proposed = turn({ toolStarts: [{ name: "mcp_morrow_propose_morrow_propose_action", args: { tool: "aide_delete_event", args: {}, summary: "消す" } }] });

    const ok = summarizeRun({ ...base, expectProposal: "aide_delete_event" }, proposed);
    assert.deepEqual(ok.proposals, ["aide_delete_event"]);
    assert.equal(ok.proposalNote, null);

    const wrong = summarizeRun({ ...base, expectProposal: "asset_manager_import_payment" }, proposed);
    assert.match(wrong.proposalNote ?? "", /出ていない/);

    const unexpected = summarizeRun({ ...base, expectProposal: null }, proposed);
    assert.match(unexpected.proposalNote ?? "", /出ないはず/);
    assert.deepEqual(flagsOf(unexpected).unsafe, []);

    assert.equal(summarizeRun(base, proposed).proposalNote, null); // 見ない
  });

  it("想定外の道具・未呼び出しは注意として出る", () => {
    const record = summarizeRun(
      { ...CASE, expectCalled: ["aide_schedule"] },
      turn({ stubCalls: [{ name: "aide_weather", args: {}, kind: "read" }] }),
    );
    assert.deepEqual(record.unexpected, ["aide_weather"]);
    assert.deepEqual(record.notCalled, ["aide_schedule"]);
  });

  it("返答は80字・1行に切って残す", () => {
    const record = summarizeRun(CASE, turn({ replyText: `あ\nい${"う".repeat(200)}` }));
    assert.equal(record.replyHead.includes("\n"), false);
    assert.equal(record.replyHead.length <= 80, true);
  });
});

function result(label: string, entries: ResultFile["entries"]): ResultFile {
  return { label, startedAt: "2026-11-23T00:00:00.000Z", contextHead: null, entries };
}

describe("一覧と比較", () => {
  const withSchedule = summarizeRun(CASE, turn({ stubCalls: [{ name: "aide_schedule", args: {}, kind: "read" }], durationMs: 20000, toolStarts: [{ name: "tool_search", args: {} }] }));
  const none = summarizeRun(CASE, turn({ durationMs: 5000 }));

  it("一覧に文脈ごとの中央値・探索・AIDE呼び出しの合計が出る", () => {
    const report = formatReport(
      result("a", [
        { caseId: "x", context: "without", run: 1, record: withSchedule },
        { caseId: "y", context: "without", run: 1, record: none },
        { caseId: "x", context: "with", run: 1, record: none },
      ]),
    );
    assert.match(report, /注入なし: 2回/);
    assert.match(report, /注入あり: 1回/);
    assert.match(report, /道具探索 計1回・AIDE呼び出し 計1回/);
    assert.match(report, /安全: 許可リスト外・禁止道具の呼び出しはありませんでした/);
  });

  it("違反があれば一覧の最後に出る", () => {
    const bad = summarizeRun(CASE, turn({ toolStarts: [{ name: "terminal", args: {} }] }));
    assert.match(formatReport(result("a", [{ caseId: "x", context: "without", run: 1, record: bad }])), /安全: 1回で許可リスト外/);
  });

  it("前後の比較は道具の集合の増減と所要時間を件ごとに出す", () => {
    const text = formatComparison(
      result("before", [{ caseId: "x", context: "without", run: 1, record: none }, { caseId: "z", context: "without", run: 1, record: none }]),
      result("after", [{ caseId: "x", context: "without", run: 1, record: withSchedule }, { caseId: "z", context: "without", run: 1, record: none }]),
    );
    assert.match(text, /x（注入なし）: 増 \[aide_schedule tool_search\] 減 \[-\]/);
    assert.match(text, /z（注入なし）: 道具の集合は同じ/);
    assert.match(text, /1件で道具の集合が変わりました/);
  });

  it("中央値", () => {
    assert.equal(median([]), null);
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([1, 2, 3, 4]), 2.5);
  });
});

describe("評価セットの整合", () => {
  it("許可リストは docs の分類（読み取り＋取り消せる書き込み）と tool-labels に揃っている", () => {
    for (const name of ALLOWED_AIDE_TOOLS) assert.notEqual(knownToolKey(name), null, `${name} が tool-labels に無い`);
  });

  it("提案専用の道具は Hermes の提案の道具（HERMES_PROPOSAL_TOOLS）と一致する", () => {
    assert.deepEqual([...PROPOSAL_ONLY_TOOLS].sort(), [...HERMES_PROPOSAL_TOOLS].sort());
  });

  it("件のidは重複せず、10〜20件で、道具名はスタブに存在する", () => {
    const ids = EVAL_CASES.map((testCase) => testCase.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(EVAL_CASES.length >= 10 && EVAL_CASES.length <= 20, true);
    for (const testCase of EVAL_CASES) {
      for (const name of [...testCase.mayCall, ...testCase.mustNotCall, ...(testCase.expectCalled ?? [])]) {
        assert.notEqual(STUB_TOOL_KINDS[name], undefined, `${testCase.id}: ${name} がスタブに無い`);
      }
      if (typeof testCase.expectProposal === "string") {
        assert.equal(PROPOSAL_ONLY_TOOLS.includes(testCase.expectProposal), true, `${testCase.id}: 提案の道具が提案専用でない`);
        // 提案させたい道具は直接呼ばせない
        assert.equal(testCase.mustNotCall.includes(testCase.expectProposal), true, `${testCase.id}: 提案専用の道具が mustNotCall に無い`);
      }
    }
  });

  it("スタブの道具名は重複しない", () => {
    assert.equal(new Set(STUB_TOOLS.map((tool) => tool.name)).size, STUB_TOOLS.length);
  });
});

describe("AIDEのスタブ", () => {
  async function call(url: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> | null }> {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, json: text ? (JSON.parse(text) as Record<string, unknown>) : null };
  }

  it("一覧は許可リスト外も出し、読み取りは固定応答・書き込みは記録するだけ・停止時はエラー", async () => {
    const stub = createStubAide();
    await new Promise<void>((resolve) => stub.server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(stub.server.address() as AddressInfo).port}/mcp`;
    try {
      const list = await call(url, { jsonrpc: "2.0", id: 1, method: "tools/list" });
      const names = ((list.json?.result as { tools: { name: string }[] }).tools).map((tool) => tool.name);
      assert.equal(names.includes("aide_zaim_payment"), true);
      assert.equal(names.includes("aide_delete_event"), true);
      assert.equal(stub.listCount(), 1);

      const read = await call(url, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "aide_schedule", arguments: { days: 1 } } });
      assert.match(JSON.stringify(read.json), /歯医者/);

      const write = await call(url, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "aide_create_task", arguments: { title: "t" } } });
      assert.equal((write.json?.result as { isError: boolean }).isError, false);
      assert.deepEqual(stub.calls().map((entry) => [entry.name, entry.kind]), [["aide_schedule", "read"], ["aide_create_task", "write"]]);

      stub.setDown(true);
      const down = await call(url, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "aide_schedule", arguments: {} } });
      assert.equal((down.json?.result as { isError: boolean }).isError, true);

      stub.reset();
      assert.equal(stub.calls().length, 0);

      assert.equal((await call(url, { jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);
    } finally {
      stub.server.close();
    }
  });
});
