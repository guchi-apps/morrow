import { flattenText } from "@/lib/mail/triage-core";

/**
 * Hermes Agentの提案（#748。設計は `docs/hermes-actions.md`）のうち、DB・ネットワークに触れない部分。
 * `test/hermes-proposal.test.ts` が固定する。クライアントのカードからもimportするので、Prismaを持ち込まない。
 *
 * 取り消せない書き込みはHermesに呼ばせず、Hermesは `morrow_propose_action` で提案だけを出す。Morrowは
 * ストリームの `tool.start` からそれを読み、**道具ごとに検証**して承認待ちの行を作る。利用者がカードで値を見て
 * 押したら、**もう一度検証し直して**許可リストの道具をMorrowのサーバーが呼ぶ。
 * 読めない値は推測で埋めず、空欄＋要確認にする（#689と同じ）。
 */

export const HERMES_PROPOSAL_TOOLS = [
  "aide_delete_event",
  "asset_manager_import_payment",
  "asset_manager_create_subscription",
  "asset_manager_add_subscription_price",
  "asset_manager_update_subscription",
  "asset_manager_record_subscription_cancellation",
] as const;
export type HermesProposalTool = (typeof HERMES_PROPOSAL_TOOLS)[number];

export function isHermesProposalTool(value: unknown): value is HermesProposalTool {
  return typeof value === "string" && (HERMES_PROPOSAL_TOOLS as readonly string[]).includes(value);
}

/** 承認待ちの期限（作ってから1時間）。 */
export const PROPOSAL_TTL_MS = 60 * 60 * 1000;
/** 実行中のまま止まった行を「結果不明」へ移すまでの時間（書き込みの待ちは30秒。それより十分長く）。 */
export const STALE_EXECUTING_MS = 5 * 60 * 1000;
/** 結果不明のまま残す時間。過ぎたら引数を消して期限切れにする。 */
export const UNKNOWN_KEEP_MS = 24 * 60 * 60 * 1000;
/** 記録の保存期間（日）。 */
export const RETENTION_DAYS = 90;

export type ProposalStatus = "pending" | "executing" | "done" | "cancelled" | "expired" | "failed" | "unknown";

export const PROPOSAL_LABELS: Record<HermesProposalTool, string> = {
  aide_delete_event: "予定の削除",
  asset_manager_import_payment: "家計簿への登録",
  asset_manager_create_subscription: "サブスクの登録",
  asset_manager_add_subscription_price: "サブスクの料金改定",
  asset_manager_update_subscription: "サブスクの契約情報の更新",
  asset_manager_record_subscription_cancellation: "サブスクの解約の記録",
};

export function idempotencyKeyFor(proposalId: string): string {
  return `morrow-hermes-${proposalId}`;
}

/**
 * 結果不明のとき、同じ入力で再実行してよいか。**AIDEの道具が二重実行を止められるものだけ。**
 * - 家計簿: `gmailMessageId`（同じ値は `duplicate`）
 * - 予定の削除: `title` 一致が条件（消えた予定は消せない）
 * - サブスクの登録: `duplicateCandidates`（同名があれば登録しない）
 * 料金改定・契約更新・解約の記録には防ぐ手段が無いので、自動では再試行せず利用者に確かめさせる。
 */
export const RETRY_SAFE: Record<HermesProposalTool, boolean> = {
  aide_delete_event: true,
  asset_manager_import_payment: true,
  asset_manager_create_subscription: true,
  asset_manager_add_subscription_price: false,
  asset_manager_update_subscription: false,
  asset_manager_record_subscription_cancellation: false,
};

/** 取り消せない書き込みの確認で「削除」と分かる赤い見た目にするか。 */
export const DANGEROUS: Record<HermesProposalTool, boolean> = {
  aide_delete_event: true,
  asset_manager_import_payment: false,
  asset_manager_create_subscription: false,
  asset_manager_add_subscription_price: false,
  asset_manager_update_subscription: false,
  asset_manager_record_subscription_cancellation: false,
};

// ---- 項目の定義 ----

type FieldKind = "text" | "int" | "number" | "date" | "bool" | "enum";
export type FieldValue = string | number | boolean | null;
export type FieldValues = Record<string, FieldValue>;

type FieldSpec = {
  key: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  /** カードで直せるか。対象を指す識別子（予定のid・契約id・メールid）は直せない。 */
  editable: boolean;
  /** カードに出さない（AIDEへ渡すだけ）。 */
  hidden?: boolean;
  max?: number;
  min?: number;
  options?: readonly string[];
};

const text = (key: string, label: string, required: boolean, max = 100, editable = true): FieldSpec => ({ key, label, kind: "text", required, editable, max });
const id = (key: string, label: string, kind: "text" | "int" = "text"): FieldSpec => ({ key, label, kind, required: true, editable: false, max: 320, min: 1 });
const date = (key: string, label: string, required: boolean): FieldSpec => ({ key, label, kind: "date", required, editable: true });
const int = (key: string, label: string, required: boolean, min: number, max: number): FieldSpec => ({ key, label, kind: "int", required, editable: true, min, max });
const num = (key: string, label: string, required: boolean, min = 0): FieldSpec => ({ key, label, kind: "number", required, editable: true, min });
const choice = (key: string, label: string, required: boolean, options: readonly string[]): FieldSpec => ({ key, label, kind: "enum", required, editable: true, options });
const flag = (key: string, label: string): FieldSpec => ({ key, label, kind: "bool", required: false, editable: true });

const PRICE_FIELDS: FieldSpec[] = [
  num("amount", "1回あたりの請求額", true),
  choice("currency", "通貨", true, ["JPY", "USD"]),
  choice("billingCycle", "周期", true, ["MONTHLY", "YEARLY"]),
  int("billingInterval", "何か月・何年ごと", true, 1, 36),
  int("billingDay", "支払日", true, 1, 31),
  int("billingMonth", "支払い月（毎年払い）", false, 1, 12),
  date("effectiveFrom", "適用開始日", true),
];

const SPECS: Record<HermesProposalTool, FieldSpec[]> = {
  aide_delete_event: [id("eventId", "予定のid"), id("calendarId", "カレンダーのid"), id("title", "予定のタイトル")],
  asset_manager_import_payment: [
    id("gmailMessageId", "元メールのid"),
    text("place", "支払先", true),
    text("name", "品目", true),
    num("amount", "金額（円・整数）", true, 1),
    date("date", "日付", true),
    text("usage", "使用量", false, 32),
    num("originalAmount", "外貨の金額", false, 0),
    text("originalCurrency", "外貨の通貨", false, 3),
    { key: "confidence", label: "確信度", kind: "number", required: false, editable: false, hidden: true, min: 0 },
  ],
  asset_manager_create_subscription: [
    text("name", "サブスク名", true),
    text("paymentMethodName", "支払い方法", true, 50),
    date("startDate", "契約開始日", true),
    ...PRICE_FIELDS,
    text("planName", "プラン名", false),
    text("priceMemo", "料金のメモ", false, 300),
  ],
  asset_manager_add_subscription_price: [
    id("subscriptionId", "契約id", "int"),
    ...PRICE_FIELDS,
    text("planName", "プラン名", false),
    text("memo", "メモ", false, 300),
  ],
  asset_manager_update_subscription: [
    id("subscriptionId", "契約id", "int"),
    id("expectedName", "契約名（照合用）"),
    text("name", "新しい契約名", false),
    choice("category", "区分", false, ["SUBSCRIPTION", "INSURANCE", "TAX", "INSTALLMENT", "OTHER_FIXED_COST"]),
    text("memo", "メモ（全文を置き換え）", false, 1000),
    date("startDate", "契約開始日", false),
    date("endDate", "契約終了日", false),
    flag("autoRenew", "自動更新"),
    flag("cancelPlanned", "解約予定"),
    text("paymentMethodName", "新しい支払い方法", false, 50),
    date("paymentMethodEffectiveFrom", "支払い方法の適用開始日", false),
  ],
  asset_manager_record_subscription_cancellation: [
    id("subscriptionId", "契約id", "int"),
    id("expectedName", "契約名（照合用）"),
    choice("stage", "段階", true, ["considering", "procedure_completed"]),
    date("usableUntil", "利用できる最終日", false),
    date("completedOn", "手続きをした日", false),
    text("note", "メモ", false, 200),
  ],
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: unknown): string | null {
  if (typeof value !== "string" || !DATE_RE.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? null : value;
}

function coerce(spec: FieldSpec, raw: unknown): FieldValue {
  switch (spec.kind) {
    case "text": {
      if (typeof raw === "number" && Number.isFinite(raw)) raw = String(raw);
      if (typeof raw !== "string") return null;
      const flat = flattenText(raw, spec.max ?? 100);
      return flat === "" ? null : flat;
    }
    case "int": {
      const n = typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw) : raw;
      return typeof n === "number" && Number.isInteger(n) && n >= (spec.min ?? 0) && n <= (spec.max ?? Number.MAX_SAFE_INTEGER) ? n : null;
    }
    case "number": {
      const n = typeof raw === "string" && /^\d+(\.\d+)?$/.test(raw.trim()) ? Number(raw) : raw;
      if (spec.key === "amount" && spec.min === 1) return typeof n === "number" && Number.isInteger(n) && n >= 1 ? n : null;
      return typeof n === "number" && Number.isFinite(n) && n >= (spec.min ?? 0) ? n : null;
    }
    case "date":
      return validDate(raw);
    case "bool":
      return typeof raw === "boolean" ? raw : null;
    case "enum": {
      const upper = typeof raw === "string" ? raw : null;
      return upper !== null && spec.options?.includes(upper) ? upper : null;
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export type Normalized = { values: FieldValues; missing: string[] };

/** 道具ごとの引数を検証する。読めない値はnullのまま（推測で埋めない）、必須で読めないものは `missing` に入る。 */
export function normalizeProposal(tool: HermesProposalTool, rawArgs: unknown): Normalized | null {
  const raw = asRecord(rawArgs);
  if (!raw) return null;
  const specs = SPECS[tool];
  const values: FieldValues = {};
  for (const spec of specs) values[spec.key] = coerce(spec, raw[spec.key]);
  if (typeof values.originalCurrency === "string") values.originalCurrency = values.originalCurrency.toUpperCase();
  if (tool === "asset_manager_import_payment" && typeof values.originalCurrency === "string" && !/^[A-Z]{3}$/.test(values.originalCurrency)) {
    values.originalCurrency = null;
  }
  // 外貨の金額と通貨は両方そろうときだけ使う
  if ((values.originalAmount === null) !== (values.originalCurrency === null)) {
    values.originalAmount = null;
    values.originalCurrency = null;
  }
  // 毎月払いに支払い月は無い
  if ("billingMonth" in values && values.billingCycle === "MONTHLY") values.billingMonth = null;

  const missing = specs.filter((s) => s.required && values[s.key] === null).map((s) => s.key);
  if ("billingMonth" in values && values.billingCycle === "YEARLY" && values.billingMonth === null) missing.push("billingMonth");
  if (tool === "asset_manager_record_subscription_cancellation" && values.stage === "procedure_completed" && values.usableUntil === null) {
    missing.push("usableUntil");
  }
  if (tool === "asset_manager_update_subscription") {
    const changes = specs.filter((s) => s.editable && s.key !== "paymentMethodEffectiveFrom").some((s) => values[s.key] !== null);
    if (!changes) missing.push("name");
    if (values.paymentMethodName !== null && values.paymentMethodEffectiveFrom === null) missing.push("paymentMethodEffectiveFrom");
  }
  return { values, missing: [...new Set(missing)] };
}

/** 保存済みの値へ、カードで直した値を重ねる。直せない項目（対象を指す識別子）は無視する。 */
export function applyEdits(tool: HermesProposalTool, stored: FieldValues, edits: unknown): FieldValues {
  const raw = asRecord(edits);
  if (!raw) return stored;
  const merged: Record<string, unknown> = { ...stored };
  for (const spec of SPECS[tool]) {
    if (spec.editable && spec.key in raw) merged[spec.key] = raw[spec.key] === "" ? null : raw[spec.key];
  }
  return merged as FieldValues;
}

/** AIDEの道具へ渡す引数（検証済みの値から作る）。足りない欄があれば理由を返す。 */
export function buildToolArgs(
  tool: HermesProposalTool,
  values: FieldValues,
): { ok: true; args: Record<string, unknown> } | { ok: false; reason: string } {
  const normalized = normalizeProposal(tool, values);
  if (!normalized) return { ok: false, reason: "入力内容を読めませんでした。" };
  if (normalized.missing.length > 0) {
    const labels = normalized.missing.map((key) => SPECS[tool].find((s) => s.key === key)?.label ?? key);
    return { ok: false, reason: `${labels.join("・")}を入力してください。` };
  }
  const args: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(normalized.values)) {
    if (value !== null) args[key] = value;
  }
  if (tool === "asset_manager_import_payment") args.confidence = typeof args.confidence === "number" && args.confidence <= 1 ? args.confidence : 0.5;
  return { ok: true, args };
}

// ---- 提案の取り込み ----

export type ProposalArgs = {
  values: FieldValues;
  summary: string;
  preview: DeletePreview | null;
  /** 削除前の確認（dryRun）が取れなかった。 */
  previewFailed: boolean;
};

export type IngestedProposal = { tool: HermesProposalTool; args: ProposalArgs; missing: string[] };

const SUMMARY_LIMIT = 120;

/**
 * ストリームの道具呼び出し（`tool.start`）から提案を読む。提案の道具でないもの・表に無い道具・形が読めないものは null（捨てる）。
 * Hermesは名前に `mcp_<サーバー>_` を付けることがあるので末尾で照合する。引数がJSON文字列で届く場合も読む。
 */
export function parseProposalEvent(name: unknown, rawArgs: unknown): IngestedProposal | null {
  if (typeof name !== "string" || !/(^|_)morrow_propose_action$/.test(name)) return null;
  let top: unknown = rawArgs;
  if (typeof top === "string") {
    try {
      top = JSON.parse(top);
    } catch {
      return null;
    }
  }
  const record = asRecord(top);
  if (!record) return null;
  const toolName = typeof record.tool === "string" ? record.tool.replace(/^mcp_aide_/, "") : record.tool;
  if (!isHermesProposalTool(toolName)) return null;
  let toolArgs: unknown = record.args;
  if (typeof toolArgs === "string") {
    try {
      toolArgs = JSON.parse(toolArgs);
    } catch {
      return null;
    }
  }
  const normalized = normalizeProposal(toolName, toolArgs);
  if (!normalized) return null;
  const summary = typeof record.summary === "string" ? flattenText(record.summary, SUMMARY_LIMIT) : "";
  return { tool: toolName, args: { values: normalized.values, summary, preview: null, previewFailed: false }, missing: normalized.missing };
}

// ---- 予定の削除前の確認（dryRun） ----

export type DeletePreview = { title: string; when: string | null; calendar: string | null };

/** `aide_delete_event` の `dryRun: true` の応答から「何を消すか」を読む。形が読めなければnull（その提案は実行させない）。 */
export function parseDeletePreview(json: unknown): DeletePreview | null {
  const top = asRecord(json);
  if (!top || top.ok === false || top.error) return null;
  const event = asRecord(top.event) ?? asRecord(top.target) ?? asRecord(top.wouldDelete) ?? top;
  const title = typeof event.title === "string" ? flattenText(event.title, 100) : "";
  if (title === "") return null;
  const day = typeof event.date === "string" ? event.date : typeof event.startDate === "string" ? event.startDate : null;
  const start = typeof event.startTime === "string" ? event.startTime : null;
  const end = typeof event.endTime === "string" ? event.endTime : null;
  const when = day ? `${day}${start ? ` ${start}${end ? `–${end}` : ""}` : "（終日）"}` : null;
  const calendar = typeof event.calendarName === "string" ? flattenText(event.calendarName, 60) : null;
  return { title, when, calendar };
}

// ---- 結果の読み替え ----

export type OutcomeKind = "done" | "duplicate" | "failed";
export type ToolOutcome = { kind: OutcomeKind; code: string; targetId: string | null; reason: string | null };

function idOf(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c === "string" && c !== "") return c.slice(0, 191);
    if (typeof c === "number" && Number.isFinite(c)) return String(c);
  }
  return null;
}

function reasonOf(json: Record<string, unknown>): string | null {
  const reason = typeof json.reason === "string" ? json.reason : typeof json.message === "string" ? json.message : null;
  return reason ? flattenText(reason, 120) : null;
}

/** 道具の結果（JSON）を読み替える。形が読めないものは「失敗」に倒す（成功と取り違えない）。 */
export function readHermesOutcome(tool: HermesProposalTool, json: Record<string, unknown>): ToolOutcome {
  const status = typeof json.status === "string" ? json.status : null;
  const failed = (code: string): ToolOutcome => ({ kind: "failed", code, targetId: null, reason: reasonOf(json) });

  if (tool === "asset_manager_import_payment") {
    const receipt = idOf(json.receiptId);
    if (status === "imported") return { kind: "done", code: "imported", targetId: receipt, reason: null };
    if (status === "pendingReview") return { kind: "done", code: "pendingReview", targetId: receipt, reason: null };
    if (status === "duplicate") return { kind: "duplicate", code: "duplicate", targetId: receipt, reason: null };
    return failed(status === "ignored" ? "ignored" : "error");
  }
  if (json.ok === false || status === "error" || json.applied === false || json.kind === "conflict") return failed("rejected");
  if (tool === "aide_delete_event") {
    return status === "dryRun" ? failed("rejected") : { kind: "done", code: "deleted", targetId: null, reason: null };
  }
  if (tool === "asset_manager_create_subscription") {
    if (status === "duplicateCandidates") return failed("duplicateCandidates");
    const sub = asRecord(json.subscription);
    return { kind: "done", code: "created", targetId: idOf(json.subscriptionId, json.id, sub?.id), reason: null };
  }
  const target = idOf(json.subscriptionId, json.id, asRecord(json.subscription)?.id);
  if (status === "unchanged") return { kind: "done", code: "unchanged", targetId: target, reason: null };
  return { kind: "done", code: "updated", targetId: target, reason: null };
}

const OUTCOME_TEXT: Record<string, string> = {
  imported: "家計簿へ取り込みました。",
  pendingReview: "取り込みました（Asset Managerで確認待ちです）。",
  duplicate: "取り込み済みでした。",
  deleted: "予定を削除しました。",
  created: "サブスクを登録しました。",
  updated: "台帳を更新しました。",
  unchanged: "すでに同じ内容でした。変更はありません。",
  duplicateCandidates: "同名・類似名の契約があるため、登録しませんでした。",
  ignored: "Asset Managerが対象外と判断しました。",
  rejected: "実行できませんでした。何も変わっていません。",
  error: "実行できませんでした。",
  unknown: "結果を確認できませんでした。反映されたかをAsset Manager・カレンダーで確かめてください。",
  unknown_expired: "結果不明のまま期限が過ぎました。反映されたかを画面で確かめてください。",
};

export function outcomeMessage(status: ProposalStatus, outcome: string | null): string | null {
  if (status === "cancelled") return "取り下げました。";
  if (status === "expired") return outcome && OUTCOME_TEXT[outcome] ? OUTCOME_TEXT[outcome]! : "期限（1時間）が過ぎたため押せません。同じことをするなら頼み直してください。";
  if (status === "executing") return "実行しています。このまま閉じても続きます。";
  if (status === "unknown") return OUTCOME_TEXT.unknown!;
  if (status === "pending") return null;
  return (outcome && OUTCOME_TEXT[outcome]) || (status === "done" ? "実行しました。" : "実行できませんでした。");
}

// ---- カード用の表示モデル ----

export type FieldView = {
  key: string;
  label: string;
  kind: FieldKind;
  value: FieldValue;
  editable: boolean;
  required: boolean;
  options: readonly string[] | null;
  /** 必須なのに読み取れなかった（「要確認」）。 */
  needsCheck: boolean;
};

export type ProposalView = {
  id: string;
  tool: HermesProposalTool;
  label: string;
  danger: boolean;
  status: ProposalStatus;
  expiresAt: string;
  summary: string;
  fields: FieldView[];
  preview: DeletePreview | null;
  /** 「実行」を押せるか。 */
  canExecute: boolean;
  /** 結果不明のあと「もう一度実行」を出してよいか（二重実行を止められる道具だけ）。 */
  canRetry: boolean;
  /** 「やめる」（取り下げ）を出すか。 */
  canCancel: boolean;
  message: string | null;
  /** 画面に出す理由（実行直後の応答でだけ入る。保存しない）。 */
  reason: string | null;
};

export type ProposalRow = {
  id: string;
  tool: string;
  status: string;
  expiresAt: Date;
  outcome: string | null;
  args: unknown;
};

function readArgs(value: unknown): ProposalArgs | null {
  const rec = asRecord(value);
  const values = asRecord(rec?.values);
  if (!rec || !values) return null;
  return {
    values: values as FieldValues,
    summary: typeof rec.summary === "string" ? rec.summary : "",
    preview: (asRecord(rec.preview) as DeletePreview | null) ?? null,
    previewFailed: rec.previewFailed === true,
  };
}

export function readProposalArgs(value: unknown): ProposalArgs | null {
  return readArgs(value);
}

export function proposalView(row: ProposalRow): ProposalView | null {
  if (!isHermesProposalTool(row.tool)) return null;
  const status = row.status as ProposalStatus;
  const args = readArgs(row.args);
  const normalized = args ? normalizeProposal(row.tool, args.values) : null;
  const missing = new Set(normalized?.missing ?? []);
  const fields: FieldView[] = args
    ? SPECS[row.tool]
        .filter((s) => !s.hidden)
        .map((s) => ({
          key: s.key,
          label: s.label,
          kind: s.kind,
          value: args.values[s.key] ?? null,
          editable: s.editable,
          required: s.required,
          options: s.options ?? null,
          needsCheck: missing.has(s.key),
        }))
    : [];
  const needsPreview = row.tool === "aide_delete_event";
  const live = status === "pending" && !!args;
  return {
    id: row.id,
    tool: row.tool,
    label: PROPOSAL_LABELS[row.tool],
    danger: DANGEROUS[row.tool],
    status,
    expiresAt: row.expiresAt.toISOString(),
    summary: args?.summary ?? "",
    fields,
    preview: args?.preview ?? null,
    canExecute: live && missing.size === 0 && (!needsPreview || !!args?.preview),
    canRetry: status === "unknown" && RETRY_SAFE[row.tool] && !!args,
    canCancel: status === "pending" || status === "unknown",
    message: outcomeMessage(status, row.outcome),
    reason: null,
  };
}

// ---- Hermesへの伝言 ----

const NOTE_VERB: Record<string, string> = {
  done: "実行しました",
  cancelled: "取り下げました",
  failed: "実行できませんでした",
  expired: "期限切れで実行されませんでした",
};

/** 次の発言の先頭に付ける、実行・取り下げの結果。値（金額・相手先・予定の内容）は入れない。 */
export function hermesNote(rows: { tool: string; status: string; outcome: string | null }[]): string {
  const lines: string[] = [];
  for (const row of rows) {
    if (!isHermesProposalTool(row.tool)) continue;
    const verb = row.status === "done" && row.outcome === "duplicate" ? "実行済みでした（重複）" : NOTE_VERB[row.status];
    if (verb) lines.push(`（Morrow: 提案「${PROPOSAL_LABELS[row.tool]}」を${verb}）`);
  }
  return lines.join("\n");
}
