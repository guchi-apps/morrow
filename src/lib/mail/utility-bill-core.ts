import { flattenText } from "@/lib/mail/triage-core";

/**
 * 電気・ガスの請求メールをクラシオ（kurashio）へ反映する（#1100）のうち、DB・ネットワークに触れない部分。
 * `test/mail-utility-bill.test.ts` が固定する。
 *
 * メールのAI分析（#766）が本文から請求の確定額・使用量・請求月（`utilityBill`）を読み取り、AIDEの
 * `kurashio_import_utility_bill` で登録する。**登録は取り消せない**（AIDEは既存の行を書き換えず、訂正の経路も無い）ので、
 * 確度が低い・契約が1つに決まらない・額が読めないときは書かず、理由を出すだけにする。
 * クラシオの保存値・結果はMorrowのDB・ログに残さない（#732。開くたびに読み直す）。
 */

export type UtilityKind = "electricity" | "gas";

export type UtilityBill = {
  kind: UtilityKind;
  /** 請求月（YYYY-MM）。メールの「◯月分」。受信日から推測しない。 */
  billingMonth: string;
  amountYen: number;
  usageValue: number | null;
  /** 電気は kWh、ガスは m3。 */
  usageUnit: string | null;
  planName: string | null;
  sourceLabel: string | null;
  confidence: number;
};

/** この確度（0〜1）以上のときだけ自動で登録する。 */
export const AUTO_REFLECT_MIN_CONFIDENCE = 0.8;
const AMOUNT_MAX = 1_000_000;
const USAGE_MAX = 100_000;
const LABEL_LIMIT = 64;

export const UTILITY_BILL_RULES: readonly string[] = [
  "utilityBill は、電気またはガスの「月ごとの確定した請求額・使用量」を知らせるメール（関西電力の使用量・料金のお知らせなど）のときだけ入れる。請求予定額が未確定のもの・水道・引き落とし日だけのお知らせ・それ以外のメールでは null",
  "utilityBill.kind は electricity（電気）か gas（ガス）",
  "utilityBill.billingMonth はメール本文に書かれた「◯年◯月分」の請求月（YYYY-MM）。受信日・検針日から推測しない。書かれていなければ utilityBill ごと null",
  "utilityBill.amountYen は請求額（円の整数）。本文に無い・分からなければ utilityBill ごと null",
  "utilityBill.usageValue と usageUnit は使用量（電気は kWh、ガスは m3）。無ければ両方 null",
  "utilityBill.planName は契約種別（「なっトクでんき」など。本文にあるときだけ）、sourceLabel は出典（「はぴeみる電」など）。無ければ null",
  "utilityBill.confidence は読み取りの確からしさ（0〜1）。請求月・額が本文にはっきり書かれていれば0.9以上、迷うなら0.5以下",
];

export const UTILITY_BILL_EXAMPLE = {
  utilityBill: { kind: "electricity", billingMonth: "2026-11", amountYen: 8912, usageValue: 275, usageUnit: "kWh", planName: "なっトクでんき", sourceLabel: "はぴeみる電", confidence: 0.95 },
};

function label(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const flat = flattenText(value, LABEL_LIMIT);
  return flat === "" ? null : flat;
}

/** 実在する請求月（YYYY-MM）だけ通す。 */
function validMonth(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : null;
}

/** 外から来た値（Codexの返答・保存済みの返答）を検証する。種別・請求月・額が読めなければnull（推測で埋めない）。 */
export function normalizeUtilityBill(raw: unknown): UtilityBill | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const kind = r.kind === "electricity" || r.kind === "gas" ? r.kind : null;
  const billingMonth = validMonth(r.billingMonth);
  const amount = typeof r.amountYen === "string" ? Number(r.amountYen.replace(/[,，円\s]/g, "")) : r.amountYen;
  if (!kind || !billingMonth || typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 || amount > AMOUNT_MAX) return null;
  const usage = typeof r.usageValue === "string" ? Number(r.usageValue.replace(/[,，\s]/g, "")) : r.usageValue;
  const hasUsage = typeof usage === "number" && Number.isFinite(usage) && usage >= 0 && usage <= USAGE_MAX;
  const unit = label(r.usageUnit);
  const confidence = typeof r.confidence === "number" && Number.isFinite(r.confidence) ? Math.min(1, Math.max(0, r.confidence)) : 0;
  return {
    kind,
    billingMonth,
    amountYen: Math.round(amount),
    // 単位だけ・使用量だけの片方は持たない（AIDEは単位だけの指定を断る）
    usageValue: hasUsage && unit ? (usage as number) : null,
    usageUnit: hasUsage && unit ? unit : null,
    planName: label(r.planName),
    sourceLabel: label(r.sourceLabel),
    confidence,
  };
}

export function parseUtilityBillReply(answer: string): UtilityBill | null {
  const start = answer.indexOf("{");
  const end = answer.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const raw = JSON.parse(answer.slice(start, end + 1)) as unknown;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    return normalizeUtilityBill((raw as Record<string, unknown>).utilityBill);
  } catch {
    return null;
  }
}

/** 自動で登録してよいか（確度が足りるか）。 */
export function isAutoReflectable(bill: UtilityBill): boolean {
  return bill.confidence >= AUTO_REFLECT_MIN_CONFIDENCE;
}

export type BillContract = { contractKey: string; planName: string | null; latestBillingMonth: string | null };

/** `kurashio_utility_bill_contracts` の応答から契約候補を読む。形が違えばnull（「候補なし」と混ぜない）。 */
export function parseContracts(json: Record<string, unknown>): BillContract[] | null {
  if (json.status !== "ok" || !Array.isArray(json.contracts)) return null;
  const out: BillContract[] = [];
  for (const item of json.contracts) {
    if (typeof item !== "object" || item === null) continue;
    const { contractKey, planName, latestBillingMonth } = item as Record<string, unknown>;
    if (typeof contractKey !== "string" || contractKey === "") continue;
    out.push({ contractKey, planName: typeof planName === "string" ? planName : null, latestBillingMonth: typeof latestBillingMonth === "string" ? latestBillingMonth : null });
  }
  return out;
}

const normalizePlan = (value: string) => value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();

/** 契約を1つに決める。候補が1件ならそれ、複数ならメールの契約種別と一致するちょうど1件。決められなければnull（推測しない）。 */
export function pickContract(contracts: BillContract[], planName: string | null): BillContract | null {
  if (contracts.length === 1) return contracts[0]!;
  if (contracts.length === 0 || !planName) return null;
  const wanted = normalizePlan(planName);
  const hits = contracts.filter((c) => c.planName !== null && normalizePlan(c.planName) === wanted);
  return hits.length === 1 ? hits[0]! : null;
}

/** `kurashio_get_utility_bill` の `found` の応答から保存済みの額・使用量を読む。 */
export type SavedBill = { amountYen: number; usageValue: number | null; usageUnit: string | null };

export function parseSavedBill(json: Record<string, unknown>): SavedBill | null {
  const record = json.record;
  if (json.status !== "found" || typeof record !== "object" || record === null) return null;
  const { amountYen, usageValue, usageUnit } = record as Record<string, unknown>;
  if (typeof amountYen !== "number" || !Number.isFinite(amountYen)) return null;
  return {
    amountYen,
    usageValue: typeof usageValue === "number" && Number.isFinite(usageValue) ? usageValue : null,
    usageUnit: typeof usageUnit === "string" ? usageUnit : null,
  };
}

/** `kurashio_import_utility_bill` へ渡す引数。`confirmNewContract` は付けない（候補に無い契約は登録しない）。 */
export function importArgs(bill: UtilityBill, contractKey: string, messageId: string, receivedAt: number | null): Record<string, unknown> {
  return {
    billingMonth: bill.billingMonth,
    kind: bill.kind,
    contractKey,
    amountYen: bill.amountYen,
    ...(bill.usageValue !== null && bill.usageUnit ? { usageValue: bill.usageValue, usageUnit: bill.usageUnit } : {}),
    ...(bill.planName ? { planName: bill.planName } : {}),
    ...(bill.sourceLabel ? { sourceLabel: bill.sourceLabel } : {}),
    ...(receivedAt !== null && Number.isFinite(receivedAt) ? { receivedAt: new Date(receivedAt).toISOString() } : {}),
    sourceMessageId: messageId,
    confidence: bill.confidence,
  };
}

/** 反映の状態。画面に出す。保存はしない。 */
export type UtilityBillState =
  /** 登録した（`created`）／すでに同じ内容があった（`already`）。 */
  | { status: "reflected"; how: "created" | "already"; bill: UtilityBill }
  /** クラシオに同じ月の行があるが、額がメールと違う（書き換えない）。 */
  | { status: "differs"; bill: UtilityBill; savedAmountYen: number }
  /** まだ登録していない（確度が低い・自動の登録を待っている）。 */
  | { status: "pending"; bill: UtilityBill; reason: "low_confidence" | "not_yet" }
  /** 契約を1つに決められない（候補が0件・複数）。登録していない。 */
  | { status: "unresolved"; bill: UtilityBill; candidates: number }
  /** 確認・登録できなかった。`scope` は権限不足（繋ぎ直しが要る）。 */
  | { status: "unavailable"; bill: UtilityBill; reason: string; scope: boolean };

export function formatYen(amount: number): string {
  return `${amount.toLocaleString("ja-JP")}円`;
}

export function describeBill(bill: UtilityBill): string {
  const [year, month] = bill.billingMonth.split("-");
  const kind = bill.kind === "electricity" ? "電気" : "ガス";
  const usage = bill.usageValue !== null && bill.usageUnit ? `・${bill.usageValue}${bill.usageUnit === "m3" ? "m³" : bill.usageUnit}` : "";
  return `${year}年${Number(month)}月分・${kind} ${formatYen(bill.amountYen)}${usage}`;
}

export type StateView = { tone: "ok" | "warn" | "muted"; text: string };

/** 状態を画面の1行にする。 */
export function describeState(state: UtilityBillState): StateView {
  const what = describeBill(state.bill);
  switch (state.status) {
    case "reflected":
      return { tone: "ok", text: state.how === "created" ? `クラシオに反映しました（${what}）` : `クラシオに反映済みです（${what}）` };
    case "differs":
      return { tone: "warn", text: `クラシオには同じ月の記録がありますが、額が違います（クラシオ ${formatYen(state.savedAmountYen)}／メール ${formatYen(state.bill.amountYen)}）。上書きはしていません` };
    case "pending":
      return state.reason === "low_confidence"
        ? { tone: "muted", text: `クラシオへは反映していません（読み取りの確度が低いため。${what}）` }
        : { tone: "muted", text: `クラシオにはまだ反映されていません（${what}）` };
    case "unresolved":
      return { tone: "warn", text: `クラシオへは反映していません（契約を1つに決められませんでした。${what}）` };
    case "unavailable":
      return { tone: "warn", text: `クラシオへの反映を確認できませんでした（${state.reason}）` };
  }
}
