import { callToolJson, callUtilityBillWriteToolJson, connectedServerFor, McpCallError, type ToolJson } from "@/lib/mcp/direct-call";
import type { ConnectedServer } from "@/lib/mcp/connections";

import {
  importArgs,
  isAutoReflectable,
  parseContracts,
  parseSavedBill,
  pickContract,
  type BillContract,
  type UtilityBill,
  type UtilityBillState,
} from "@/lib/mail/utility-bill-core";

/**
 * 電気・ガスの請求メールのクラシオへの反映（#1100）。**サーバー専用。** 契約候補（`kurashio_utility_bill_contracts`）→
 * 同じ請求月の保存済みの行（`kurashio_get_utility_bill`）→ 無ければ `kurashio_import_utility_bill`、の順に進める。
 * 結果はどこにも保存しない（#732。クラシオが持つ。開くたびに読み直す）。呼び出し側が先にメールの持ち主を照合する。
 *
 * - **自動で書くのは「確度が足りて、契約が1つに決まり、同じ月の行が無い」ときだけ**。登録は取り消せない
 * - 契約を1つに決められないときも、候補すべての同じ請求月の行を調べる（#1200。引っ越しで同じ種別の契約が2件あっても、
 *   日次収集が入れた行は「反映済み」になる）。登録はしない
 * - すでに同じ月の行があれば書かない（Hermesのcron〔`kepco_bill_auto_import.py`〕が先に取り込んでいた場合もここで「反映済み」になる）。
 *   額が違えば `differs`（上書きしない）
 * - 取得・登録できなかった回は `unavailable`（「反映されていない」と混ぜない。権限不足は繋ぎ直しの案内。#214）
 */

function errorState(bill: UtilityBill, error: unknown): UtilityBillState {
  const reason = error instanceof McpCallError ? error.reason : null;
  const scope = reason?.includes("繋ぎ直してください") === true;
  if (!reason) console.error("[aide-bot] クラシオの電気・ガス請求の確認に失敗した", error instanceof Error ? error.message : error);
  return { status: "unavailable", bill, reason: reason ?? "時間をおいて開き直してください", scope };
}

/** 外部とのやり取り。テストでだけ差し替える。 */
export type UtilityBillIo = {
  connect: (userId: string) => Promise<ConnectedServer | null>;
  read: typeof callToolJson;
  write: typeof callUtilityBillWriteToolJson;
};

const DEFAULT_IO: UtilityBillIo = {
  connect: (userId) => connectedServerFor(userId, "aide"),
  read: callToolJson,
  write: callUtilityBillWriteToolJson,
};

/** 保存済みの行。`not_found` だけを「行が無い」とし、読めない応答は失敗にする（#214）。 */
async function savedFor(io: UtilityBillIo, server: ConnectedServer, bill: UtilityBill, contractKey: string) {
  const json = await io.read(server, "kurashio_get_utility_bill", { kind: bill.kind, contractKey, billingMonth: bill.billingMonth });
  const saved = parseSavedBill(json);
  if (!saved && json.status !== "not_found") throw new Error("kurashio_get_utility_bill の応答を読めない");
  return saved;
}

function compare(bill: UtilityBill, saved: { amountYen: number }, how: "created" | "already"): UtilityBillState {
  return saved.amountYen === bill.amountYen ? { status: "reflected", how, bill } : { status: "differs", bill, savedAmountsYen: [saved.amountYen] };
}

/**
 * 契約を1つに決められないとき、候補すべての同じ請求月の行を調べる（#1200）。金額が一致する行があれば反映済み。
 * 一致が無く照会に失敗した契約があれば、そこに一致する行があるかもしれないので失敗にする。**登録はしない。**
 */
async function checkCandidates(io: UtilityBillIo, server: ConnectedServer, bill: UtilityBill, contracts: BillContract[]): Promise<UtilityBillState> {
  const results = await Promise.allSettled(contracts.map((c) => savedFor(io, server, bill, c.contractKey)));
  const amounts = results.flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value.amountYen] : []));
  if (amounts.includes(bill.amountYen)) return { status: "reflected", how: "already", bill };
  const failed = results.find((r) => r.status === "rejected");
  if (failed) throw failed.reason;
  if (amounts.length > 0) return { status: "differs", bill, savedAmountsYen: amounts };
  return { status: "unresolved", bill, candidates: contracts.length };
}

export async function syncUtilityBill(
  userId: string,
  messageId: string,
  bill: UtilityBill,
  receivedAt: number | null,
  options: { write: boolean },
  io: UtilityBillIo = DEFAULT_IO,
): Promise<UtilityBillState> {
  const server = await io.connect(userId).catch(() => null);
  if (!server) return { status: "unavailable", bill, reason: "AIDEが接続されていません", scope: false };
  try {
    const contracts = parseContracts(await io.read(server, "kurashio_utility_bill_contracts", { kind: bill.kind }));
    if (!contracts) return { status: "unavailable", bill, reason: "契約候補を読めませんでした", scope: false };
    const contract = pickContract(contracts, bill.planName);
    if (!contract) return await checkCandidates(io, server, bill, contracts);

    const existing = await savedFor(io, server, bill, contract.contractKey);
    if (existing) return compare(bill, existing, "already");

    if (!options.write) return { status: "pending", bill, reason: "not_yet" };
    if (!isAutoReflectable(bill)) return { status: "pending", bill, reason: "low_confidence" };

    let json: ToolJson;
    try {
      json = await io.write(server, "kurashio_import_utility_bill", importArgs(bill, contract.contractKey, messageId, receivedAt));
    } catch (error) {
      const status = error instanceof McpCallError ? error.status : null;
      if (status === "contract_unresolved" || status === "contract_month_conflict") return { status: "unresolved", bill, candidates: contracts.length };
      // 値違い・読み戻せなかった・応答待ちの超過は、保存されている値を読み直して決める（盲目的に再送しない）
      if (status === "conflict" || status === "unverified" || status === "unknown") {
        const saved = await savedFor(io, server, bill, contract.contractKey).catch(() => null);
        if (saved) return compare(bill, saved, status === "conflict" ? "already" : "created");
      }
      return errorState(bill, error);
    }
    const how = json.status === "duplicate" ? "already" : "created";
    return { status: "reflected", how, bill };
  } catch (error) {
    return errorState(bill, error);
  }
}
