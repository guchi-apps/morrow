import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  commitOutcomeOf,
  parseApprovalState,
  parseSalaryLookup,
  parseSalaryPreview,
  recheckOutcomeOf,
  safeApprovalUrl,
  salaryFailureOf,
  salaryMailbox,
} from "@/lib/mail/salary-core";

/**
 * 給与明細PDFの取り込み（#1170）。応答の例は2026-11-24に AIDE（src/mcp/tools/salary-agent.ts）と
 * Asset Manager（lib/payroll/agent-import-server.ts）のソースから組み立てた。金額はダミー。
 */

const PREVIEW = {
  status: "ok",
  previewToken: "tok.abc",
  previewId: "cm1preview",
  approvalPath: "/salaries/agent/approvals/cm1preview",
  approvalReadPath: "/api/salaries/agent/approvals/cm1preview",
  contentHash: "h",
  expiresAt: "2026-11-24T09:30:00.000Z",
  salaryDate: { year: 2026, month: 11, candidate: "2026-11-25", confirmed: false },
  lines: [
    { label: "基本給", amount: 300000, kind: "payment", destination: "field:baseSalary", destinationLabel: "基本給" },
    { label: "健康保険", amount: 15000, kind: "deduction", destination: null, destinationLabel: null },
  ],
  unassignedLabels: [],
  totals: { computed: { grossSalary: 320000, netSalary: 250000 }, pdf: { grossTotal: 320000, netTotal: 250000 }, difference: { gross: 0, net: 0 } },
  blockers: [],
  existing: { alreadyImportedSalaryId: null, sameDateSalaryId: null, sameMonthSalaries: [] },
  canSave: true,
  approvalUrl: "https://asset.gucchii.com/salaries/agent/approvals/cm1preview",
  registered: false,
  note: "プレビューのみ",
};

describe("承認画面のURLの検証（計画レビュー1）", () => {
  it("Asset Managerの承認画面だけを通す", () => {
    assert.equal(safeApprovalUrl("https://asset.gucchii.com/salaries/agent/approvals/cm1preview"), "https://asset.gucchii.com/salaries/agent/approvals/cm1preview");
  });
  it("別オリジン・http・javascript:・別パス・クエリ付きは落とす", () => {
    for (const value of [
      "https://evil.example.com/salaries/agent/approvals/cm1",
      "http://asset.gucchii.com/salaries/agent/approvals/cm1",
      "javascript:alert(1)",
      "https://asset.gucchii.com/salaries/new",
      "https://asset.gucchii.com/salaries/agent/approvals/cm1?next=https://evil.example.com",
      "https://user@asset.gucchii.com/salaries/agent/approvals/cm1",
      "https://asset.gucchii.com.evil.example.com/salaries/agent/approvals/cm1",
      "/salaries/agent/approvals/cm1",
      42,
    ]) {
      assert.equal(safeApprovalUrl(value), null, String(value));
    }
  });
});

describe("解析の応答", () => {
  it("読めた値を画面向けにし、previewTokenは分けて返す", () => {
    const parsed = parseSalaryPreview(PREVIEW)!;
    assert.equal(parsed.previewToken, "tok.abc");
    assert.equal("previewToken" in parsed.preview, false);
    assert.equal(parsed.preview.salaryDateCandidate, "2026-11-25");
    assert.equal(parsed.preview.grossSalary, 320000);
    assert.equal(parsed.preview.netSalary, 250000);
    assert.equal(parsed.preview.lines.length, 2);
    assert.equal(parsed.preview.canSave, true);
    assert.equal(parsed.preview.approvalUrl, PREVIEW.approvalUrl);
  });
  it("blockers があれば canSave を立てない", () => {
    const parsed = parseSalaryPreview({ ...PREVIEW, canSave: true, blockers: [{ code: "gross_mismatch", message: "計算した支給額が明細の総支給額と一致しません" }] })!;
    assert.deepEqual(parsed.preview.blockers, ["計算した支給額が明細の総支給額と一致しません"]);
    assert.equal(parsed.preview.canSave, false);
  });
  it("承認画面のURLが外れていれば null（画面は手動の取り込みへ案内）", () => {
    assert.equal(parseSalaryPreview({ ...PREVIEW, approvalUrl: "https://evil.example.com/x" })!.preview.approvalUrl, null);
  });
  it("取込済みのIDを読む", () => {
    const parsed = parseSalaryPreview({ ...PREVIEW, existing: { alreadyImportedSalaryId: "cm1salary", sameDateSalaryId: null } })!;
    assert.equal(parsed.preview.alreadyImportedSalaryId, "cm1salary");
  });
  it("previewId・previewToken が無い応答は読めない", () => {
    assert.equal(parseSalaryPreview({ ...PREVIEW, previewToken: undefined }), null);
    assert.equal(parseSalaryPreview({ ...PREVIEW, previewId: "../x" }), null);
    assert.equal(parseSalaryPreview(null), null);
  });
});

describe("解析の失敗の読み替え", () => {
  it("パスワード付き・読めないPDFは手動の取り込みへ", () => {
    const body = { status: "error", code: "needs_password", registered: false, reason: "パスワード付きのPDFは代理登録できません", httpStatus: 422 };
    assert.equal(salaryFailureOf(body, body.reason).manual, true);
    assert.equal(salaryFailureOf({ status: "error", code: "unreadable" }, null).manual, true);
  });
  it("それ以外は理由をそのまま出す", () => {
    assert.deepEqual(salaryFailureOf(null, "接続にこの操作の許可がありません。設定の接続から繋ぎ直してください"), {
      message: "接続にこの操作の許可がありません。設定の接続から繋ぎ直してください",
      manual: false,
    });
  });
});

describe("承認状態", () => {
  it("previewId が一致する状態だけ読む", () => {
    assert.equal(parseApprovalState({ status: "ok", previewId: "cm1", approval: "approved", canCommit: true }, "cm1"), "approved");
    assert.equal(parseApprovalState({ status: "ok", previewId: "cm2", approval: "approved" }, "cm1"), null);
    assert.equal(parseApprovalState({ status: "ok", previewId: "cm1", approval: "yes" }, "cm1"), null);
    assert.equal(parseApprovalState({ status: "not_found", previewId: "cm1" }, "cm1"), "not_found");
  });
});

describe("保存の結果（計画レビュー2）", () => {
  it("登録できた（読み戻しへ）", () => {
    assert.deepEqual(commitOutcomeOf({ status: "saved_unverified", registered: true, verified: false, salaryId: "cm1salary" }, null), { kind: "saved", salaryId: "cm1salary" });
  });
  it("成功の形をしていない成功応答は unknown", () => {
    assert.deepEqual(commitOutcomeOf({ status: "saved_unverified", registered: true }, null), { kind: "unknown" });
  });
  it("登録済み・未承認・保存しなかった", () => {
    assert.deepEqual(commitOutcomeOf(null, { body: { status: "already_registered", registered: false, existingSalaryId: "cm1old" }, reason: null }), { kind: "already", salaryId: "cm1old" });
    assert.deepEqual(commitOutcomeOf(null, { body: { status: "not_approved", registered: false, approval: "pending" }, reason: null }), { kind: "not_approved", approval: "pending" });
    assert.deepEqual(commitOutcomeOf(null, { body: { status: "error", code: "date_conflict", registered: false, existingSalaryId: "cm1x" }, reason: "同じ支給日の明細があります" }), {
      kind: "refused",
      message: "同じ支給日の明細があります",
      existingSalaryId: "cm1x",
    });
  });
  it("応答待ち切れ・登録が分からないものは unknown（再送しない）", () => {
    assert.deepEqual(commitOutcomeOf(null, { body: { status: "unknown", registered: "unknown" }, reason: null }), { kind: "unknown" });
    assert.deepEqual(commitOutcomeOf(null, { body: { status: "error", reason: "接続に失敗" }, reason: "接続に失敗" }), { kind: "unknown" });
    assert.deepEqual(commitOutcomeOf(null, { body: null, reason: null }), { kind: "unknown" });
  });
  it("引き直したプレビューで登録の有無を決める", () => {
    const base = parseSalaryPreview(PREVIEW)!.preview;
    assert.deepEqual(recheckOutcomeOf({ ...base, alreadyImportedSalaryId: "cm1salary" }), { kind: "registered", salaryId: "cm1salary" });
    assert.deepEqual(recheckOutcomeOf(base), { kind: "not_registered" });
    assert.deepEqual(recheckOutcomeOf(null), { kind: "unconfirmed" });
  });
});

describe("読み戻し・メールボックス", () => {
  it("同じIDの明細だけ読む", () => {
    const json = { status: "found", salary: { id: "cm1salary", salaryDate: "2026-11-25", grossSalary: 320000, netSalary: 250000 } };
    assert.deepEqual(parseSalaryLookup(json, "cm1salary"), { id: "cm1salary", salaryDate: "2026-11-25", grossSalary: 320000, netSalary: 250000 });
    assert.equal(parseSalaryLookup(json, "cm1other"), null);
    assert.equal(parseSalaryLookup({ status: "not_found" }, "cm1salary"), null);
  });
  it("メールボックスはアドレスの形だけ（小文字に揃える）", () => {
    assert.equal(salaryMailbox(" Someone@Example.com "), "someone@example.com");
    assert.equal(salaryMailbox("main"), null);
  });
});
