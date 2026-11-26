import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildAnalyzePrompt, parseAnalyzeReply } from "@/lib/mail/analyze-core";
import { syncUtilityBill, type UtilityBillIo } from "@/lib/mail/utility-bill";
import { McpCallError } from "@/lib/mcp/direct-call";
import { toolErrorStatus } from "@/lib/mcp/tool-error";
import {
  describeState,
  importArgs,
  isAutoReflectable,
  normalizeUtilityBill,
  parseContracts,
  parseSavedBill,
  parseUtilityBillReply,
  pickContract,
  type UtilityBill,
} from "@/lib/mail/utility-bill-core";

/**
 * 電気・ガスの請求メールのクラシオへの反映（#1100）のうち、DB・ネットワークに触れない部分。
 * AIDEの `kurashio_*` の契約: 入力・応答は ~/apps/aide の `src/mcp/tools/kurashio-bills.ts`（2026-11-19に確認。
 * 応答は `{ status: "ok", kind, contracts: [{ contractKey, planName, latestBillingMonth }] }`・
 * `{ status: "found", record: { billingMonth, kind, contractKey, planName, amountYen, usageValue, usageUnit, ... } }`。
 * 書き込みの `conflict`・`contract_unresolved` などは `isError: true` で返る）。
 */

const raw = { kind: "electricity", billingMonth: "2026-11", amountYen: 8912, usageValue: 275, usageUnit: "kWh", planName: "なっトクでんき", sourceLabel: "はぴeみる電", confidence: 0.95 };
const bill = (over: Record<string, unknown> = {}): UtilityBill => normalizeUtilityBill({ ...raw, ...over })!;

describe("normalizeUtilityBill / parseUtilityBillReply", () => {
  it("種別・請求月・額が読めなければnull（推測で埋めない）", () => {
    assert.equal(normalizeUtilityBill({ ...raw, kind: "water" }), null);
    assert.equal(normalizeUtilityBill({ ...raw, billingMonth: "2026-13" }), null);
    assert.equal(normalizeUtilityBill({ ...raw, billingMonth: "2026-11-05" }), null);
    assert.equal(normalizeUtilityBill({ ...raw, amountYen: null }), null);
    assert.equal(normalizeUtilityBill({ ...raw, amountYen: -1 }), null);
    assert.equal(normalizeUtilityBill(null), null);
    assert.equal(normalizeUtilityBill([]), null);
  });
  it("カンマ・円付きの額を読み、確度は0〜1に収める", () => {
    assert.equal(bill({ amountYen: "8,912円" }).amountYen, 8912);
    assert.equal(bill({ confidence: 5 }).confidence, 1);
    assert.equal(bill({ confidence: "高" }).confidence, 0);
  });
  it("使用量と単位は両方そろったときだけ持つ", () => {
    assert.equal(bill({ usageUnit: null }).usageValue, null);
    assert.equal(bill({ usageValue: null }).usageUnit, null);
    assert.equal(bill().usageValue, 275);
  });
  it("返答に埋め込まれたJSONから読み、分析の返答にも載る", () => {
    assert.equal(parseUtilityBillReply(`前置き ${JSON.stringify({ utilityBill: raw })}`)?.billingMonth, "2026-11");
    assert.equal(parseUtilityBillReply(JSON.stringify({ utilityBill: null })), null);
    assert.equal(parseUtilityBillReply("JSONではない"), null);
    const base = { summary: "要約", points: ["a"], recommended: null, suggestions: [] };
    assert.equal(parseAnalyzeReply(JSON.stringify({ ...base, utilityBill: raw }))?.utilityBill?.amountYen, 8912);
    assert.equal(parseAnalyzeReply(JSON.stringify(base))?.utilityBill, null);
  });
  it("プロンプトに読み取りの決まりと出力の例が入る", () => {
    const prompt = buildAnalyzePrompt({ from: "a", subject: "b", body: "c", receivedDate: null, today: "2026-11-19" });
    assert.match(prompt, /電気・ガスの請求の読み取り/);
    assert.match(prompt, /"utilityBill"/);
  });
});

describe("自動で登録してよいか・契約の決め方", () => {
  it("確度0.8以上だけ自動で登録する", () => {
    assert.equal(isAutoReflectable(bill({ confidence: 0.8 })), true);
    assert.equal(isAutoReflectable(bill({ confidence: 0.79 })), false);
  });
  const contracts = parseContracts({ status: "ok", kind: "electricity", contracts: [{ contractKey: "k1", planName: "なっトクでんき", latestBillingMonth: "2026-10" }, { contractKey: "k2", planName: "はぴeプラン", latestBillingMonth: "2026-10" }] })!;
  it("候補が1件ならそれ、複数なら契約種別が一致するちょうど1件。決められなければnull", () => {
    assert.equal(pickContract([contracts[0]!], null)?.contractKey, "k1");
    assert.equal(pickContract(contracts, "なっトクでんき")?.contractKey, "k1");
    assert.equal(pickContract(contracts, "なっトクでんき ")?.contractKey, "k1");
    assert.equal(pickContract(contracts, null), null);
    assert.equal(pickContract(contracts, "別のプラン"), null);
    assert.equal(pickContract([], "なっトクでんき"), null);
    assert.equal(pickContract([{ contractKey: "a", planName: "x", latestBillingMonth: null }, { contractKey: "b", planName: "x", latestBillingMonth: null }], "x"), null);
  });
  it("契約候補・保存済みの応答の形が違えばnull", () => {
    assert.equal(parseContracts({ status: "failed" }), null);
    assert.equal(parseContracts({ status: "ok" }), null);
    assert.deepEqual(parseContracts({ status: "ok", contracts: [] }), []);
    assert.equal(parseSavedBill({ status: "not_found" }), null);
    assert.deepEqual(parseSavedBill({ status: "found", record: { amountYen: 8912, usageValue: 275, usageUnit: "kWh" } }), { amountYen: 8912, usageValue: 275, usageUnit: "kWh" });
  });
});

describe("importArgs（AIDEの kurashio_import_utility_bill の入力）", () => {
  it("必須項目と、あるときだけの任意項目を渡し、confirmNewContract は付けない", () => {
    const args = importArgs(bill(), "k1", "msg-1", Date.parse("2026-11-05T09:12:00+09:00"));
    assert.deepEqual(args, {
      billingMonth: "2026-11",
      kind: "electricity",
      contractKey: "k1",
      amountYen: 8912,
      usageValue: 275,
      usageUnit: "kWh",
      planName: "なっトクでんき",
      sourceLabel: "はぴeみる電",
      receivedAt: "2026-11-05T00:12:00.000Z",
      sourceMessageId: "msg-1",
      confidence: 0.95,
    });
    assert.equal("confirmNewContract" in args, false);
  });
  it("使用量・契約種別・受信日が無ければ引数ごと外す（additionalProperties:false・単位だけは断られる）", () => {
    const args = importArgs(bill({ usageValue: null, planName: null, sourceLabel: null }), "k1", "msg-1", null);
    assert.deepEqual(Object.keys(args).sort(), ["amountYen", "billingMonth", "confidence", "contractKey", "kind", "sourceMessageId"]);
  });
});

describe("状態の表示", () => {
  const b = bill();
  it("反映した・反映済み・額が違う・未反映・契約不明・確認できないを分けて出す", () => {
    assert.match(describeState({ status: "reflected", how: "created", bill: b }).text, /反映しました（2026年11月分・電気 8,912円・275kWh）/);
    assert.match(describeState({ status: "reflected", how: "already", bill: b }).text, /反映済みです/);
    assert.equal(describeState({ status: "reflected", how: "already", bill: b }).tone, "ok");
    assert.match(describeState({ status: "differs", bill: b, savedAmountsYen: [8000] }).text, /クラシオ 8,000円.*メール 8,912円.*上書きはしていません/);
    assert.match(describeState({ status: "pending", bill: b, reason: "not_yet" }).text, /まだ反映されていません/);
    assert.match(describeState({ status: "pending", bill: b, reason: "low_confidence" }).text, /確度が低い/);
    assert.match(describeState({ status: "unresolved", bill: b, candidates: 2 }).text, /契約を1つに決められません/);
    assert.match(describeState({ status: "unavailable", bill: b, reason: "接続にこの操作の許可がありません。設定の接続から繋ぎ直してください", scope: true }).text, /確認できませんでした.*繋ぎ直して/);
  });
  it("ガスはm³で出す", () => {
    assert.match(describeState({ status: "reflected", how: "created", bill: bill({ kind: "gas", usageValue: 12, usageUnit: "m3" }) }).text, /ガス 8,912円・12m³/);
  });
});

describe("道具のエラーの status（#1100）", () => {
  it("JSONの status を読む。英小文字と_だけ", () => {
    assert.equal(toolErrorStatus({ isError: true, content: [{ type: "text", text: JSON.stringify({ status: "conflict", reason: "x" }) }] }), "conflict");
    assert.equal(toolErrorStatus({ isError: true, structuredContent: { status: "contract_unresolved" } }), "contract_unresolved");
    assert.equal(toolErrorStatus({ isError: true, content: [{ type: "text", text: JSON.stringify({ status: "<script>" }) }] }), null);
    assert.equal(toolErrorStatus({ isError: true, content: [{ type: "text", text: "プレーン" }] }), null);
    assert.equal(new McpCallError("x", "r", "conflict").status, "conflict");
    assert.equal(new McpCallError("x").status, null);
  });
});

describe("契約を1つに決められないとき（#1200）", () => {
  const b = bill({ kind: "gas", planName: null });
  const found = (amountYen: number) => ({ status: "found", record: { amountYen } });
  const none = { status: "not_found" };

  /** 契約k1・k2の2件。`rows` は契約ごとの `kurashio_get_utility_bill` の応答（Errorなら照会失敗）。 */
  async function run(rows: Record<string, Record<string, unknown> | Error>) {
    const writes: string[] = [];
    const io: UtilityBillIo = {
      connect: async () => ({}) as never,
      read: async (_server, tool, args) => {
        if (tool === "kurashio_utility_bill_contracts") return { status: "ok", contracts: [{ contractKey: "k1" }, { contractKey: "k2" }] };
        const { contractKey, billingMonth } = args as { contractKey: string; billingMonth: string };
        assert.equal(billingMonth, b.billingMonth);
        const row = rows[contractKey]!;
        if (row instanceof Error) throw row;
        return row;
      },
      write: async (_server, tool) => {
        writes.push(tool);
        return { status: "created" };
      },
    };
    const state = await syncUtilityBill("u1", "msg-1", b, null, { write: true }, io);
    assert.deepEqual(writes, [], "契約を決められないときは登録しない");
    return state;
  }

  it("片方に同じ請求月・同じ金額の行があれば反映済み", async () => {
    assert.deepEqual(await run({ k1: none, k2: found(b.amountYen) }), { status: "reflected", how: "already", bill: b });
    assert.equal((await run({ k1: new McpCallError("x", "時間切れ"), k2: found(b.amountYen) })).status, "reflected");
  });
  it("行はあるが額が違えば differs（上書きしない）", async () => {
    assert.deepEqual(await run({ k1: found(100), k2: found(200) }), { status: "differs", bill: b, savedAmountsYen: [100, 200] });
  });
  it("どの候補にも行が無ければ unresolved", async () => {
    assert.deepEqual(await run({ k1: none, k2: none }), { status: "unresolved", bill: b, candidates: 2 });
  });
  it("照会に失敗した回は「行が無い」と混ぜない", async () => {
    assert.equal((await run({ k1: none, k2: new McpCallError("x", "時間切れ") })).status, "unavailable");
    assert.equal((await run({ k1: found(100), k2: { status: "failed" } })).status, "unavailable");
  });
});
