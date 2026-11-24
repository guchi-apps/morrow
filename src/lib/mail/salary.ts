import { getMailAttachment, type MailUser } from "@/lib/mail/aide-client";
import { checkAttachmentContent, previewContentType } from "@/lib/mail/attachment-check";
import { MAIL_FAILURE_MESSAGES } from "@/lib/mail/contract";
import {
  APPROVAL_MESSAGES,
  SALARY_PDF_MAX_BYTES,
  UNKNOWN_MESSAGES,
  commitOutcomeOf,
  parseApprovalState,
  parseSalaryLookup,
  parseSalaryPreview,
  recheckOutcomeOf,
  salaryCommitArgs,
  salaryFailureOf,
  salaryMailbox,
  salaryPreviewArgs,
  type SalaryCommitResult,
  type SalaryFailure,
  type SalaryPreview,
  type SalaryRecord,
} from "@/lib/mail/salary-core";
import type { ConnectedServer } from "@/lib/mcp/connections";
import { McpCallError, callSalaryWriteToolJson, callToolJson, connectedServerFor } from "@/lib/mcp/direct-call";

/**
 * メールの給与明細PDFをAsset Managerの給与台帳へ取り込む（#1170）。決まりごとは `salary-core.ts`。
 *
 * - PDFは毎回AIDEのメールAPIから取り直し（`getMailAttachment()` が持ち主を照合）、Morrowで中身を検査して `safe` のPDFだけ送る
 * - **`previewToken` はブラウザへ渡さず、プロセス内に30分だけ持つ**（再起動で消えたら解析からやり直し）。金額・氏名はDB・ログに残さない（#732）
 * - 保存の結果が分からない回は**再送しない**。同じメール・PDFでプレビューを引き直して登録の有無を確かめる
 */

type Pending = { userId: string; messageId: string; attachmentId: string; previewToken: string; expiresAt: number };

const TTL_MS = 30 * 60 * 1000;
const MAX_PENDING = 50;
const store = ((globalThis as { __morrowSalaryPreviews?: Map<string, Pending> }).__morrowSalaryPreviews ??= new Map<string, Pending>());

function remember(previewId: string, pending: Pending) {
  const now = Date.now();
  for (const [key, value] of store) if (value.expiresAt <= now) store.delete(key);
  while (store.size >= MAX_PENDING) store.delete(store.keys().next().value!);
  store.set(previewId, pending);
}

function recall(userId: string, previewId: string): Pending | null {
  const pending = store.get(previewId);
  if (!pending || pending.userId !== userId) return null;
  if (pending.expiresAt <= Date.now()) {
    store.delete(previewId);
    return null;
  }
  return pending;
}

export type SalaryPreviewOutcome =
  | { ok: true; preview: SalaryPreview }
  | { ok: false; status: number; failure: SalaryFailure };

type PdfSource = { mailbox: string; pdfBase64: string };

async function loadPdf(user: MailUser, messageId: string, attachmentId: string): Promise<{ ok: true; value: PdfSource } | { ok: false; status: number; failure: SalaryFailure }> {
  const result = await getMailAttachment(user, messageId, attachmentId);
  if (!result.ok) {
    const status = result.kind === "not_owner" ? 403 : result.kind === "not_found" ? 404 : result.kind === "invalid_request" ? 400 : 502;
    return { ok: false, status, failure: { message: result.message ?? MAIL_FAILURE_MESSAGES[result.kind], manual: false } };
  }
  const { owner, filename, mimeType, data } = result.value;
  const mailbox = salaryMailbox(owner);
  if (!mailbox) return { ok: false, status: 502, failure: { message: "メールの持ち主を確かめられませんでした。", manual: false } };
  if (previewContentType(data) !== "application/pdf") return { ok: false, status: 422, failure: { message: "この添付はPDFではありません。", manual: false } };
  if (checkAttachmentContent(filename, mimeType, data).verdict !== "safe") {
    return { ok: false, status: 422, failure: { message: "検査で注意が必要と判定したPDFなので、Morrowからは送りません。Asset Managerの給与の登録画面で取り込んでください。", manual: true } };
  }
  if (data.length > SALARY_PDF_MAX_BYTES) {
    return { ok: false, status: 413, failure: { message: "PDFが大きすぎるため（700KBまで）、Morrowからは送れません。Asset Managerの給与の登録画面で取り込んでください。", manual: true } };
  }
  return { ok: true, value: { mailbox, pdfBase64: Buffer.from(data).toString("base64") } };
}

async function aide(userId: string): Promise<ConnectedServer | null> {
  return connectedServerFor(userId, "aide").catch(() => null);
}

const NO_AIDE: SalaryFailure = { message: "AIDEが接続されていません。設定の接続から繋いでください。", manual: false };

function failureFromError(error: unknown): SalaryFailure {
  if (error instanceof McpCallError) return salaryFailureOf(error.body, error.reason);
  return { message: "AIDEへ繋がりませんでした。時間をおいてやり直してください。", manual: false };
}

async function runPreview(server: ConnectedServer, messageId: string, pdf: PdfSource) {
  return parseSalaryPreview(
    await callSalaryWriteToolJson(server, "asset_manager_salary_preview", salaryPreviewArgs(pdf, messageId)),
  );
}

/** 添付PDFを解析し、承認待ちの記録を作る。保存はしない。 */
export async function previewSalary(user: MailUser, messageId: string, attachmentId: string): Promise<SalaryPreviewOutcome> {
  const server = await aide(user.id);
  if (!server) return { ok: false, status: 503, failure: NO_AIDE };
  const pdf = await loadPdf(user, messageId, attachmentId);
  if (!pdf.ok) return pdf;
  try {
    const parsed = await runPreview(server, messageId, pdf.value);
    if (!parsed) return { ok: false, status: 502, failure: { message: "解析の結果を読めませんでした。", manual: false } };
    remember(parsed.preview.previewId, { userId: user.id, messageId, attachmentId, previewToken: parsed.previewToken, expiresAt: Date.now() + TTL_MS });
    return { ok: true, preview: parsed.preview };
  } catch (error) {
    console.warn("[salary] 解析に失敗しました", error instanceof McpCallError ? error.status ?? "error" : "network");
    return { ok: false, status: 502, failure: failureFromError(error) };
  }
}

async function lookup(server: ConnectedServer, salaryId: string): Promise<SalaryRecord | null> {
  try {
    return parseSalaryLookup(await callToolJson(server, "asset_manager_salary_lookup", { salaryId }), salaryId);
  } catch {
    return null;
  }
}

/**
 * 本人がAsset Managerの画面で承認したプレビューを保存する。承認状態を先に読み、承認済みのときだけPDFを取り直して送る。
 */
export async function commitSalary(user: MailUser, previewId: string): Promise<{ ok: true; result: SalaryCommitResult } | { ok: false; status: number; failure: SalaryFailure }> {
  const pending = recall(user.id, previewId);
  if (!pending) return { ok: false, status: 410, failure: { message: "解析の結果が見つかりません（30分の期限切れ・再起動）。もう一度「給与明細として取り込む」から始めてください。", manual: false } };
  const server = await aide(user.id);
  if (!server) return { ok: false, status: 503, failure: NO_AIDE };

  try {
    const state = parseApprovalState(await callToolJson(server, "asset_manager_salary_approval_status", { previewId }), previewId);
    if (state === "not_found" || state === null) return { ok: false, status: 502, failure: { message: "承認の状態を読めませんでした。", manual: false } };
    if (state !== "approved") return { ok: true, result: { status: "not_approved", message: APPROVAL_MESSAGES[state] } };
  } catch (error) {
    return { ok: false, status: 502, failure: failureFromError(error) };
  }

  const pdf = await loadPdf(user, pending.messageId, pending.attachmentId);
  if (!pdf.ok) return pdf;

  let outcome;
  try {
    const json = await callSalaryWriteToolJson(server, "asset_manager_salary_commit", salaryCommitArgs(pdf.value, pending.messageId, previewId, pending.previewToken));
    outcome = commitOutcomeOf(json, null);
  } catch (error) {
    // 時間切れ・通信の失敗は、向こうで保存できたかが分からない
    outcome = error instanceof McpCallError ? commitOutcomeOf(null, { body: error.body, reason: error.reason }) : ({ kind: "unknown" } as const);
  }

  switch (outcome.kind) {
    case "saved":
    case "already":
      store.delete(previewId);
      return { ok: true, result: { status: "registered", record: await lookup(server, outcome.salaryId), already: outcome.kind === "already" } };
    case "not_approved":
      return { ok: true, result: { status: "not_approved", message: outcome.approval && outcome.approval !== "approved" ? APPROVAL_MESSAGES[outcome.approval] : "Asset Managerで承認されていないため、登録していません。" } };
    case "refused":
      return { ok: true, result: { status: "refused", message: outcome.message } };
    case "unknown": {
      store.delete(previewId);
      // 同じ保存は再送しない。同じメール・同じPDFでプレビューを引き直し、取込済みかで判定する（AIDEの指示）
      let recheck: SalaryPreview | null = null;
      try {
        recheck = (await runPreview(server, pending.messageId, pdf.value))?.preview ?? null;
      } catch {
        recheck = null;
      }
      const confirmed = recheckOutcomeOf(recheck);
      if (confirmed.kind === "registered") {
        return { ok: true, result: { status: "registered", record: await lookup(server, confirmed.salaryId), already: false } };
      }
      return { ok: true, result: { status: "unknown", confirmed: confirmed.kind, message: UNKNOWN_MESSAGES[confirmed.kind] } };
    }
  }
}
