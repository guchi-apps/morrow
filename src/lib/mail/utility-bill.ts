import { callToolJson, callUtilityBillWriteToolJson, connectedServerFor, McpCallError, type ToolJson } from "@/lib/mcp/direct-call";
import type { ConnectedServer } from "@/lib/mcp/connections";

import {
  importArgs,
  isAutoReflectable,
  parseContracts,
  parseSavedBill,
  pickContract,
  type UtilityBill,
  type UtilityBillState,
} from "@/lib/mail/utility-bill-core";

/**
 * 電気・ガスの請求メールのクラシオへの反映（#1100）。**サーバー専用。** 契約候補（`kurashio_utility_bill_contracts`）→
 * 同じ請求月の保存済みの行（`kurashio_get_utility_bill`）→ 無ければ `kurashio_import_utility_bill`、の順に進める。
 * 結果はどこにも保存しない（#732。クラシオが持つ。開くたびに読み直す）。呼び出し側が先にメールの持ち主を照合する。
 *
 * - **自動で書くのは「確度が足りて、契約が1つに決まり、同じ月の行が無い」ときだけ**。登録は取り消せない
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

async function savedFor(server: ConnectedServer, bill: UtilityBill, contractKey: string) {
  const json = await callToolJson(server, "kurashio_get_utility_bill", { kind: bill.kind, contractKey, billingMonth: bill.billingMonth });
  return parseSavedBill(json);
}

function compare(bill: UtilityBill, saved: { amountYen: number }, how: "created" | "already"): UtilityBillState {
  return saved.amountYen === bill.amountYen ? { status: "reflected", how, bill } : { status: "differs", bill, savedAmountYen: saved.amountYen };
}

export async function syncUtilityBill(
  userId: string,
  messageId: string,
  bill: UtilityBill,
  receivedAt: number | null,
  options: { write: boolean },
): Promise<UtilityBillState> {
  const server = await connectedServerFor(userId, "aide").catch(() => null);
  if (!server) return { status: "unavailable", bill, reason: "AIDEが接続されていません", scope: false };
  try {
    const contracts = parseContracts(await callToolJson(server, "kurashio_utility_bill_contracts", { kind: bill.kind }));
    if (!contracts) return { status: "unavailable", bill, reason: "契約候補を読めませんでした", scope: false };
    const contract = pickContract(contracts, bill.planName);
    if (!contract) return { status: "unresolved", bill, candidates: contracts.length };

    const existing = await savedFor(server, bill, contract.contractKey);
    if (existing) return compare(bill, existing, "already");

    if (!options.write) return { status: "pending", bill, reason: "not_yet" };
    if (!isAutoReflectable(bill)) return { status: "pending", bill, reason: "low_confidence" };

    let json: ToolJson;
    try {
      json = await callUtilityBillWriteToolJson(server, "kurashio_import_utility_bill", importArgs(bill, contract.contractKey, messageId, receivedAt));
    } catch (error) {
      const status = error instanceof McpCallError ? error.status : null;
      if (status === "contract_unresolved" || status === "contract_month_conflict") return { status: "unresolved", bill, candidates: contracts.length };
      // 値違い・読み戻せなかった・応答待ちの超過は、保存されている値を読み直して決める（盲目的に再送しない）
      if (status === "conflict" || status === "unverified" || status === "unknown") {
        const saved = await savedFor(server, bill, contract.contractKey).catch(() => null);
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
