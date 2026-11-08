import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  applyEdits,
  buildToolArgs,
  hermesNote,
  HERMES_PROPOSAL_TOOLS,
  idempotencyKeyFor,
  normalizeProposal,
  parseDeletePreview,
  parseProposalEvent,
  proposalView,
  readHermesOutcome,
  RETRY_SAFE,
} from "@/lib/hermes/proposal-core";

/** Hermesの提案（#748）のうち、DB・ネットワークに触れない部分。 */

const payment = { gmailMessageId: "m-1", place: "関西電力", name: "電気料金", amount: 4820, date: "2026-11-05", confidence: 0.8 };
const del = { eventId: "e1", calendarId: "c1", title: "歯医者" };

describe("parseProposalEvent", () => {
  it("名前に接頭辞が付いても、引数がJSON文字列でも読む", () => {
    const a = parseProposalEvent("mcp_morrow_morrow_propose_action", { tool: "asset_manager_import_payment", args: payment, summary: "電気料金を登録" });
    assert.equal(a?.tool, "asset_manager_import_payment");
    assert.deepEqual(a?.missing, []);
    const b = parseProposalEvent("morrow_propose_action", JSON.stringify({ tool: "aide_delete_event", args: JSON.stringify(del) }));
    assert.equal(b?.tool, "aide_delete_event");
  });

  it("表に無い道具・提案でない道具・壊れた形は捨てる", () => {
    assert.equal(parseProposalEvent("morrow_propose_action", { tool: "aide_zaim_payment", args: {} }), null);
    assert.equal(parseProposalEvent("morrow_propose_action", { tool: "aide_create_event", args: {} }), null);
    assert.equal(parseProposalEvent("aide_schedule", { tool: "aide_delete_event", args: del }), null);
    assert.equal(parseProposalEvent("morrow_propose_action", "{"), null);
    assert.equal(parseProposalEvent("morrow_propose_action", { tool: "aide_delete_event", args: "x" }), null);
  });

  it("読めない値は推測で埋めず、要確認にする", () => {
    const p = parseProposalEvent("morrow_propose_action", { tool: "asset_manager_import_payment", args: { ...payment, amount: "約5千円", date: "2026-02-30" } });
    assert.deepEqual(p?.missing.sort(), ["amount", "date"]);
    assert.equal(p?.args.values.amount, null);
  });
});

describe("buildToolArgs", () => {
  it("家計簿は gmailMessageId が無いと組み立てない", () => {
    const rest: Record<string, unknown> = { ...payment };
    delete rest.gmailMessageId;
    const n = normalizeProposal("asset_manager_import_payment", rest)!;
    assert.deepEqual(n.missing, ["gmailMessageId"]);
    assert.equal(buildToolArgs("asset_manager_import_payment", n.values).ok, false);
  });

  it("家計簿の引数にはメールid・確信度が入り、外貨は両方そろうときだけ", () => {
    const ok = buildToolArgs("asset_manager_import_payment", normalizeProposal("asset_manager_import_payment", { ...payment, originalAmount: 9.99 })!.values);
    assert.ok(ok.ok);
    if (ok.ok) {
      assert.equal(ok.args.gmailMessageId, "m-1");
      assert.equal(ok.args.confidence, 0.8);
      assert.equal("originalAmount" in ok.args, false);
    }
  });

  it("毎月払いの支払い月は落とし、毎年払いで無ければ要確認", () => {
    const base = { name: "X", paymentMethodName: "カード", startDate: "2026-11-01", amount: 980, currency: "JPY", billingInterval: 1, billingDay: 5, effectiveFrom: "2026-11-01" };
    assert.equal(normalizeProposal("asset_manager_create_subscription", { ...base, billingCycle: "MONTHLY", billingMonth: 3 })!.values.billingMonth, null);
    assert.deepEqual(normalizeProposal("asset_manager_create_subscription", { ...base, billingCycle: "YEARLY" })!.missing, ["billingMonth"]);
  });

  it("契約の更新は変更が1つも無ければ、支払い方法は適用開始日とセットで要る", () => {
    const base = { subscriptionId: 3, expectedName: "X" };
    assert.ok(normalizeProposal("asset_manager_update_subscription", base)!.missing.length > 0);
    assert.deepEqual(normalizeProposal("asset_manager_update_subscription", { ...base, paymentMethodName: "新カード" })!.missing, ["paymentMethodEffectiveFrom"]);
    assert.deepEqual(normalizeProposal("asset_manager_update_subscription", { ...base, memo: "m" })!.missing, []);
  });

  it("解約の記録は手続き完了なら最終日が要る", () => {
    const base = { subscriptionId: 3, expectedName: "X", stage: "procedure_completed" };
    assert.deepEqual(normalizeProposal("asset_manager_record_subscription_cancellation", base)!.missing, ["usableUntil"]);
  });
});

describe("applyEdits", () => {
  it("対象を指す識別子は直せない", () => {
    const stored = normalizeProposal("aide_delete_event", del)!.values;
    assert.deepEqual(applyEdits("aide_delete_event", stored, { eventId: "other", title: "別" }), stored);
  });

  it("直した値は取り込まれ、検証し直される", () => {
    const stored = normalizeProposal("asset_manager_import_payment", { ...payment, amount: null })!.values;
    const edited = applyEdits("asset_manager_import_payment", stored, { amount: "4820" });
    assert.equal(buildToolArgs("asset_manager_import_payment", edited).ok, true);
    assert.equal(buildToolArgs("asset_manager_import_payment", applyEdits("asset_manager_import_payment", stored, { amount: "abc" })).ok, false);
  });
});

describe("重複防止と結果", () => {
  it("手段の無い3道具は自動で再試行しない", () => {
    for (const tool of ["asset_manager_add_subscription_price", "asset_manager_update_subscription", "asset_manager_record_subscription_cancellation"] as const) {
      assert.equal(RETRY_SAFE[tool], false, tool);
    }
    assert.equal(RETRY_SAFE.asset_manager_import_payment, true);
  });

  it("表は6本で、冪等キーは提案idから作る", () => {
    assert.equal(HERMES_PROPOSAL_TOOLS.length, 6);
    assert.equal(idempotencyKeyFor("abc"), "morrow-hermes-abc");
  });

  it("結果の読み替え", () => {
    assert.equal(readHermesOutcome("asset_manager_import_payment", { status: "imported", receiptId: 7 }).targetId, "7");
    assert.equal(readHermesOutcome("asset_manager_import_payment", { status: "duplicate" }).kind, "duplicate");
    assert.equal(readHermesOutcome("asset_manager_import_payment", { status: "ignored" }).kind, "failed");
    assert.equal(readHermesOutcome("aide_delete_event", { kind: "conflict", currentTitle: "x" }).kind, "failed");
    assert.equal(readHermesOutcome("aide_delete_event", { ok: true }).code, "deleted");
    assert.equal(readHermesOutcome("asset_manager_create_subscription", { status: "duplicateCandidates" }).kind, "failed");
    assert.equal(readHermesOutcome("asset_manager_update_subscription", { status: "unchanged" }).code, "unchanged");
    assert.equal(readHermesOutcome("asset_manager_update_subscription", { applied: false }).kind, "failed");
  });

  it("削除前の確認の応答を読む（読めなければnull＝実行させない）", () => {
    assert.deepEqual(parseDeletePreview({ event: { title: "歯医者", date: "2026-11-09", startTime: "15:00", endTime: "16:00" } }), {
      title: "歯医者",
      when: "2026-11-09 15:00–16:00",
      calendar: null,
    });
    assert.equal(parseDeletePreview({ ok: false }), null);
    assert.equal(parseDeletePreview({}), null);
  });
});

describe("カードと伝言", () => {
  const row = (extra: object) => ({ id: "p1", tool: "aide_delete_event", status: "pending", expiresAt: new Date(), outcome: null, args: null, ...extra });
  const args = (preview: unknown) => ({ values: normalizeProposal("aide_delete_event", del)!.values, summary: "", preview, previewFailed: !preview });

  it("削除は実物の確認が取れたときだけ実行できる", () => {
    assert.equal(proposalView(row({ args: args(null) }))?.canExecute, false);
    assert.equal(proposalView(row({ args: args({ title: "歯医者", when: null, calendar: null }) }))?.canExecute, true);
  });

  it("確定した行は値を持たない", () => {
    const v = proposalView(row({ status: "done", outcome: "deleted" }))!;
    assert.deepEqual(v.fields, []);
    assert.equal(v.canExecute, false);
    assert.equal(v.message, "予定を削除しました。");
  });

  it("結果不明は、重複を止められる道具だけ再実行を出す", () => {
    assert.equal(proposalView(row({ status: "unknown", args: args(null) }))?.canRetry, true);
    const sub = { values: normalizeProposal("asset_manager_update_subscription", { subscriptionId: 1, expectedName: "X", memo: "m" })!.values, summary: "", preview: null, previewFailed: false };
    const v = proposalView(row({ tool: "asset_manager_update_subscription", status: "unknown", args: sub }))!;
    assert.equal(v.canRetry, false);
    assert.equal(v.canCancel, true);
  });

  it("Hermesへの伝言に値を入れない", () => {
    const note = hermesNote([
      { tool: "asset_manager_import_payment", status: "done", outcome: "imported" },
      { tool: "aide_delete_event", status: "cancelled", outcome: null },
      { tool: "bogus", status: "done", outcome: null },
    ]);
    assert.equal(note, "（Morrow: 提案「家計簿への登録」を実行しました）\n（Morrow: 提案「予定の削除」を取り下げました）");
  });
});

describe("dryRunの固定（direct-call.ts）", () => {
  const source = readFileSync(new URL("../src/lib/mcp/direct-call.ts", import.meta.url), "utf8");

  it("確認用はdryRun: trueをリテラルで持ち、実行用はdryRunを断る", () => {
    const preview = source.slice(source.indexOf("export async function previewDeleteEvent"));
    assert.match(preview.slice(0, 500), /dryRun: true/);
    const exec = source.slice(source.indexOf("export async function callHermesWriteToolJson"), source.indexOf("export async function previewDeleteEvent"));
    assert.match(exec, /"dryRun" in args/);
  });

  it("許可リストは表の6本と一致する", () => {
    const list = source.slice(source.indexOf("HERMES_WRITE_TOOLS = ["), source.indexOf("] as const", source.indexOf("HERMES_WRITE_TOOLS = [")));
    for (const tool of HERMES_PROPOSAL_TOOLS) assert.ok(list.includes(`"${tool}"`), tool);
  });
});
