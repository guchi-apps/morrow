import { ASSET_MANAGER_ORIGIN } from "@/lib/mail/payment-receipt";

/**
 * 給与明細PDFをAsset Managerの給与台帳へ取り込む（#1170）ときの、画面とサーバーで共有する決まりごと。依存を持たない（純粋。
 * クライアントからもimportする。`test/mail-salary.test.ts`）。
 *
 * 流れ: AIDEの `asset_manager_salary_preview`（解析・承認待ちの記録を作る）→ 本人がAsset Managerの承認画面で支給日を確定して承認
 * → `asset_manager_salary_approval_status` で承認を確かめる → `asset_manager_salary_commit` → `asset_manager_salary_lookup` で読み戻す。
 * 契約の正はAIDEの `src/mcp/tools/salary-agent.ts`（aide#725・#728）とAsset Managerの `lib/payroll/agent-import-server.ts`
 * （2026-11-24に両方のソースから写した。`docs/external-tool-contracts.md`）。
 */

/** AIDEが受け付けるPDFの上限（デコード後。`MAX_PDF_BYTES`）。超えるとMCPの受け口（1MiB）に収まらない。 */
export const SALARY_PDF_MAX_BYTES = 700_000;

/** パスワード付き・読めない・大きすぎるPDFの案内先（Asset Managerの手動の取り込み画面）。 */
export const SALARY_MANUAL_IMPORT_URL = `${ASSET_MANAGER_ORIGIN}/salaries/new`;

/** 承認画面のパス（AIDEが `approvalPath` をこの形のときだけ `approvalUrl` にする）。 */
const APPROVAL_PATH = /^\/salaries\/agent\/approvals\/[A-Za-z0-9_-]{1,64}$/;
/** Asset ManagerのプレビューID・Salary ID（cuid）。AIDEの `RECORD_ID` と同じ。 */
const RECORD_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAILBOX = /^[^\s@]+@[^\s@]+$/;

export function isSalaryRecordId(value: unknown): value is string {
  return typeof value === "string" && RECORD_ID.test(value);
}

/**
 * 元メールの識別に使うメールボックス（AIDEの `mailbox`。メールアドレスの形が必須）。
 * MorrowはAIDEの応答の `owner`（ログイン中の人のメールと照合済み）を使う。追加アカウントのメールも、
 * メッセージIDに `<鍵>~` の接頭辞が付くので `gmailMessageId` 側で区別される。**冪等の鍵になるので変えない。**
 */
export function salaryMailbox(owner: string): string | null {
  const mailbox = owner.trim().toLowerCase();
  return mailbox.length <= 255 && MAILBOX.test(mailbox) ? mailbox : null;
}

/** `asset_manager_salary_preview` の引数（`test/external-tool-contracts.test.ts` が入力の範囲を固定する）。 */
export function salaryPreviewArgs(source: { mailbox: string; pdfBase64: string }, messageId: string): Record<string, unknown> {
  return { mailbox: source.mailbox, gmailMessageId: messageId, pdfBase64: source.pdfBase64 };
}

/** `asset_manager_salary_commit` の引数。承認を得たプレビューのものをそのまま渡す。 */
export function salaryCommitArgs(source: { mailbox: string; pdfBase64: string }, messageId: string, previewId: string, previewToken: string): Record<string, unknown> {
  return { ...salaryPreviewArgs(source, messageId), previewId, previewToken };
}

/**
 * AIDEが返した承認画面のURLを検証する（計画レビュー1）。`https` のAsset Managerのオリジンで、承認画面のパスの形のものだけ。
 * 外れたらnull（画面は「承認画面を開けません」と手動の取り込み画面を案内する）。
 */
export function safeApprovalUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 512) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.origin !== ASSET_MANAGER_ORIGIN) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (!APPROVAL_PATH.test(url.pathname)) return null;
  return url.href;
}

export type SalaryLine = { label: string; amount: number; destinationLabel: string | null };

/** 画面へ渡す解析の結果。**`previewToken` は入れない**（サーバーのプロセス内にだけ持つ）。 */
export type SalaryPreview = {
  previewId: string;
  approvalUrl: string | null;
  expiresAt: string | null;
  year: number | null;
  month: number | null;
  /** 前回の支給日から推した支給日（確定ではない。承認画面で本人が確定する）。 */
  salaryDateCandidate: string | null;
  lines: SalaryLine[];
  unassignedLabels: string[];
  grossSalary: number | null;
  netSalary: number | null;
  pdfGrossTotal: number | null;
  pdfNetTotal: number | null;
  blockers: string[];
  alreadyImportedSalaryId: string | null;
  sameDateSalaryId: string | null;
  canSave: boolean;
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function int(value: unknown): number | null {
  const n = num(value);
  return n !== null && Number.isInteger(n) ? n : null;
}
function str(value: unknown, limit = 200): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, limit) : null;
}
function id(value: unknown): string | null {
  return isSalaryRecordId(value) ? value : null;
}
function date(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

/**
 * `asset_manager_salary_preview` の成功応答を読む。`previewId`・`previewToken` が無い・形が違うものはnull（「取得できませんでした」）。
 */
export function parseSalaryPreview(json: unknown): { preview: SalaryPreview; previewToken: string } | null {
  const body = record(json);
  const previewId = id(body.previewId);
  const previewToken = typeof body.previewToken === "string" && body.previewToken.length > 0 && body.previewToken.length <= 4096 ? body.previewToken : null;
  if (!previewId || !previewToken) return null;

  const salaryDate = record(body.salaryDate);
  const totals = record(body.totals);
  const computed = record(totals.computed);
  const pdf = record(totals.pdf);
  const existing = record(body.existing);
  const lines = (Array.isArray(body.lines) ? body.lines : []).slice(0, 80).flatMap((raw): SalaryLine[] => {
    const line = record(raw);
    const label = str(line.label, 60);
    const amount = num(line.amount);
    if (!label || amount === null) return [];
    return [{ label, amount, destinationLabel: str(line.destinationLabel, 60) }];
  });
  const unassignedLabels = (Array.isArray(body.unassignedLabels) ? body.unassignedLabels : []).slice(0, 40).flatMap((v) => str(v, 60) ?? []);
  const blockers = (Array.isArray(body.blockers) ? body.blockers : []).slice(0, 20).flatMap((raw) => {
    const blocker = record(raw);
    return str(blocker.message, 120) ?? str(blocker.code, 40) ?? [];
  });

  return {
    previewToken,
    preview: {
      previewId,
      approvalUrl: safeApprovalUrl(body.approvalUrl),
      expiresAt: str(body.expiresAt, 40),
      year: int(salaryDate.year),
      month: int(salaryDate.month),
      salaryDateCandidate: date(salaryDate.candidate),
      lines,
      unassignedLabels,
      grossSalary: num(computed.grossSalary),
      netSalary: num(computed.netSalary),
      pdfGrossTotal: num(pdf.grossTotal),
      pdfNetTotal: num(pdf.netTotal),
      blockers,
      alreadyImportedSalaryId: id(existing.alreadyImportedSalaryId),
      sameDateSalaryId: id(existing.sameDateSalaryId),
      // 保存を止める理由が読めていないのに保存できると見せない
      canSave: body.canSave === true && blockers.length === 0,
    },
  };
}

/** 解析が断られたときの、画面に出す理由と手動の取り込み画面へ案内するか。 */
export type SalaryFailure = { message: string; manual: boolean };

/**
 * `isError` の応答（`McpCallError.body`）から、画面に出す理由を作る。AIDEは向こうの理由コードを `code` に残す。
 * 金額・本文は載らない（`reason` は短い文）。
 */
export function salaryFailureOf(body: Record<string, unknown> | null, reason: string | null): SalaryFailure {
  const code = body ? str(body.code, 40) : null;
  if (code === "needs_password") return { message: "パスワード付きのPDFは、Morrowからは取り込めません。Asset Managerの給与の登録画面で取り込んでください。", manual: true };
  if (code === "unreadable") return { message: "PDFを給与明細として読み取れませんでした。Asset Managerの給与の登録画面で取り込んでください。", manual: true };
  const status = body ? str(body.status, 40) : null;
  if (status === "not_configured") return { message: "AIDEとAsset Managerの給与連携が設定されていません。", manual: true };
  return { message: reason ?? "給与明細を取り込めませんでした。時間をおいてやり直してください。", manual: status === "invalid" };
}

export const SALARY_APPROVAL_STATES = ["pending", "approved", "rejected", "consumed", "expired"] as const;
export type SalaryApprovalState = (typeof SALARY_APPROVAL_STATES)[number];

/** `asset_manager_salary_approval_status` の応答を読む。読めない・見つからないものはnull。 */
export function parseApprovalState(json: unknown, previewId: string): SalaryApprovalState | "not_found" | null {
  const body = record(json);
  if (body.status === "not_found") return "not_found";
  if (body.previewId !== previewId) return null;
  return (SALARY_APPROVAL_STATES as readonly unknown[]).includes(body.approval) ? (body.approval as SalaryApprovalState) : null;
}

/** 承認されていないときに画面へ出す文。 */
export const APPROVAL_MESSAGES: Record<Exclude<SalaryApprovalState, "approved">, string> = {
  pending: "まだAsset Managerで承認されていません。承認画面で支給日を確定して「承認」を押してから、もう一度押してください。",
  rejected: "Asset Managerで却下されたため、登録していません。",
  consumed: "この承認はすでに登録に使われています。",
  expired: "承認の期限（30分）が切れました。もう一度「給与明細として取り込む」からやり直してください。",
};

/**
 * `asset_manager_salary_commit` の結果の読み替え。
 * - `saved`: 新しく登録した（読み戻しで確かめる）
 * - `already`: 同じメールの明細が登録済み（新しく作っていない）
 * - `not_approved`: 承認されていない（AIDEが送らなかった）
 * - `refused`: Asset Managerが保存しなかった（blockers・同日の既存明細など）
 * - `unknown`: 応答待ちが切れた・形が読めない。**再送せず**、プレビューを引き直して確かめる（計画レビュー2）
 */
export type CommitOutcome =
  | { kind: "saved"; salaryId: string }
  | { kind: "already"; salaryId: string }
  | { kind: "not_approved"; approval: SalaryApprovalState | null }
  | { kind: "refused"; message: string; existingSalaryId: string | null }
  | { kind: "unknown" };

/**
 * @param json 成功応答（`isError` でない）。失敗なら null
 * @param error `isError` の応答（`McpCallError.body`）と理由。成功なら null
 * 通信の失敗・時間切れ（`McpCallError` 以外の例外）は呼び出し側が `{ kind: "unknown" }` にする。
 */
export function commitOutcomeOf(json: Record<string, unknown> | null, error: { body: Record<string, unknown> | null; reason: string | null } | null): CommitOutcome {
  if (json) {
    const salaryId = id(json.salaryId);
    if (json.status === "saved_unverified" && json.registered === true && salaryId) return { kind: "saved", salaryId };
    return { kind: "unknown" };
  }
  const body = error?.body ?? null;
  if (!body) return { kind: "unknown" };
  if (body.registered === "unknown" || body.status === "unknown") return { kind: "unknown" };
  if (body.status === "already_registered") {
    const salaryId = id(body.existingSalaryId);
    return salaryId ? { kind: "already", salaryId } : { kind: "unknown" };
  }
  if (body.status === "not_approved") {
    const approval = (SALARY_APPROVAL_STATES as readonly unknown[]).includes(body.approval) ? (body.approval as SalaryApprovalState) : null;
    return { kind: "not_approved", approval };
  }
  // 登録していないと明言された失敗だけを「保存されなかった」と出す。言っていないものは確かめに回す
  if (body.registered === false) {
    return { kind: "refused", message: error?.reason ?? "Asset Managerが登録しませんでした。", existingSalaryId: id(body.existingSalaryId) };
  }
  return { kind: "unknown" };
}

/**
 * 保存の結果が分からなかったあと、同じメール・同じPDFでプレビューを引き直した結果から登録の有無を決める（AIDEの指示どおり）。
 * 引き直しに失敗した（null）なら「確かめられなかった」。
 */
export function recheckOutcomeOf(preview: SalaryPreview | null): { kind: "registered"; salaryId: string } | { kind: "not_registered" } | { kind: "unconfirmed" } {
  if (!preview) return { kind: "unconfirmed" };
  return preview.alreadyImportedSalaryId ? { kind: "registered", salaryId: preview.alreadyImportedSalaryId } : { kind: "not_registered" };
}

export type SalaryRecord = { id: string; salaryDate: string | null; grossSalary: number | null; netSalary: number | null };

/** `asset_manager_salary_lookup` の応答を読む。見つからない・読めないものはnull。 */
export function parseSalaryLookup(json: unknown, salaryId: string): SalaryRecord | null {
  const body = record(json);
  if (body.status !== "found") return null;
  const salary = record(body.salary);
  if (salary.id !== salaryId) return null;
  return { id: salaryId, salaryDate: date(salary.salaryDate), grossSalary: num(salary.grossSalary), netSalary: num(salary.netSalary) };
}

/** 画面へ返す登録の結果。 */
export type SalaryCommitResult =
  | { status: "registered"; record: SalaryRecord | null; already: boolean }
  | { status: "not_approved"; message: string }
  | { status: "refused"; message: string }
  /** 結果が分からず、プレビューの引き直しで登録済みと確かめた／確かめられなかった */
  | { status: "unknown"; confirmed: "registered" | "not_registered" | "unconfirmed"; message: string };

export const UNKNOWN_MESSAGES = {
  registered: "応答が途中で切れましたが、登録済みであることを確かめました。",
  not_registered: "応答が途中で切れ、登録されていないことを確かめました。もう一度「給与明細として取り込む」からやり直してください。",
  unconfirmed: "応答が途中で切れ、登録できたか確かめられませんでした。二重登録を避けるため自動ではやり直しません。Asset Managerの給与一覧で確かめてください。",
} as const;
