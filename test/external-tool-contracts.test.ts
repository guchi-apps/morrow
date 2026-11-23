import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeSuggestion, toolCallFor } from "@/lib/mail/suggest-core";
import { importArgs, normalizeUtilityBill } from "@/lib/mail/utility-bill-core";
import { cardConfirmArgs } from "@/lib/mail/withdrawal-core";

/**
 * 外部ツール（AIDE MCP）の入力契約（#854）。正は `docs/external-tool-contracts.md`。
 *
 * 入力定義は2026-11-09にAIDEの `tools/list` から写した（`additionalProperties: false` はすべて共通）。
 * Morrowが呼ぶ引数がこの範囲に収まることを固定する。**AIDE側が変わったら、この表とdocsを一緒に直す。**
 * 呼び出し側（`link.ts`・`dashboard/aide.ts` など）の引数を変えたら、ここへ同じ形を足して通す。
 */

type Prop = {
  type: "string" | "integer" | "number" | "boolean" | "object" | "array" | "nullable-string" | "nullable-integer";
  enum?: readonly string[];
  min?: number;
  max?: number;
  maxLength?: number;
  pattern?: RegExp;
};
type Schema = { props: Record<string, Prop>; required?: readonly string[] };

const SCHEMAS: Record<string, Schema> = {
  aide_schedule: {
    props: {
      date: { type: "string" },
      days: { type: "integer", min: 1, max: 14 },
      freeFrom: { type: "string" },
      freeTo: { type: "string" },
      includeOverdueTasks: { type: "boolean" },
      offsetDays: { type: "integer", min: -31, max: 90 },
    },
  },
  aide_weather: { props: {} },
  aide_balances: { props: {} },
  asset_manager_subscriptions: {
    props: { includeEnded: { type: "boolean" }, includeHistory: { type: "boolean" }, name: { type: "string" } },
  },
  // #910。2026-11-15に guchi-apps/aide#856 の実装（src/mcp/tools/asset-manager.ts）から写した（コネクタは未更新のためtools/listではなくソース）
  asset_manager_card_withdrawals: { props: { days: { type: "integer", min: 1, max: 62 } } },
  asset_manager_confirm_card_withdrawal: {
    props: {
      cardId: { type: "integer", min: 1 },
      cardName: { type: "string", maxLength: 191 },
      paymentDate: { type: "string", pattern: /^\d{4}-\d{2}-\d{2}$/ },
      amount: { type: "integer", min: 0, max: 100_000_000 },
      sourceKey: { type: "string", maxLength: 191 },
      note: { type: "string", maxLength: 191 },
    },
    required: ["paymentDate", "amount", "sourceKey"],
  },
  // #1100。2026-11-19に ~/apps/aide の src/mcp/tools/kurashio-bills.ts（inputSchema）から写した
  kurashio_utility_bill_contracts: { props: { kind: { type: "string", enum: ["electricity", "gas"] } }, required: ["kind"] },
  kurashio_get_utility_bill: {
    props: {
      kind: { type: "string", enum: ["electricity", "gas"] },
      contractKey: { type: "string" },
      billingMonth: { type: "string", pattern: /^\d{4}-(0[1-9]|1[0-2])$/ },
      sourceMessageId: { type: "string", maxLength: 255 },
    },
    required: ["kind", "contractKey"],
  },
  kurashio_import_utility_bill: {
    props: {
      billingMonth: { type: "string", pattern: /^\d{4}-(0[1-9]|1[0-2])$/ },
      kind: { type: "string", enum: ["electricity", "gas"] },
      contractKey: { type: "string" },
      amountYen: { type: "integer", min: 0, max: 1_000_000 },
      usageValue: { type: "number", min: 0, max: 100_000 },
      usageUnit: { type: "string", maxLength: 16 },
      planName: { type: "string", maxLength: 64 },
      receivedAt: { type: "string" },
      sourceMessageId: { type: "string", maxLength: 255 },
      sourceLabel: { type: "string", maxLength: 64 },
      confidence: { type: "number", min: 0, max: 1 },
      confirmNewContract: { type: "boolean" },
      dryRun: { type: "boolean" },
    },
    required: ["billingMonth", "kind", "contractKey", "sourceMessageId", "confidence"],
  },
  aide_tasks: {
    props: {
      cursor: { type: "string" },
      dateField: { type: "string", enum: ["due", "planned", "none"] },
      from: { type: "string" },
      limit: { type: "integer", min: 1, max: 100 },
      status: { type: "string", enum: ["open", "completed", "skipped"] },
      to: { type: "string" },
    },
  },
  aide_create_task: {
    props: {
      due: { type: "nullable-string" },
      idempotencyKey: { type: "string" },
      memo: { type: "nullable-string" },
      planned: { type: "nullable-string" },
      priority: { type: "nullable-string" },
      progress: { type: "nullable-integer", min: 0, max: 100 },
      recurrence: { type: "nullable-string" },
      tags: { type: "array" },
      title: { type: "string" },
    },
    required: ["title", "idempotencyKey"],
  },
  aide_create_event: {
    props: {
      calendarId: { type: "string" },
      date: { type: "string" },
      dryRun: { type: "boolean" },
      endDate: { type: "string" },
      endTime: { type: "string" },
      idempotencyKey: { type: "string" },
      location: { type: "string" },
      startTime: { type: "string" },
      title: { type: "string" },
    },
    required: ["title", "date"],
  },
  aide_delete_event: {
    props: {
      calendarId: { type: "string" },
      dryRun: { type: "boolean" },
      eventId: { type: "string" },
      title: { type: "string" },
    },
    required: ["eventId", "calendarId", "title"],
  },
  asset_manager_import_payment: {
    props: {
      accountHint: { type: "string" },
      amount: { type: "integer", min: 1 },
      amountApproximate: { type: "boolean" },
      amountNote: { type: "string", maxLength: 191 },
      confidence: { type: "number", min: 0, max: 1 },
      date: { type: "string", pattern: /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})?)?$/ },
      gmailMessageId: { type: "string" },
      items: { type: "array" },
      name: { type: "string" },
      originalAmount: { type: "number", min: Number.MIN_VALUE },
      originalCurrency: { type: "string", pattern: /^[A-Za-z]{3}$/ },
      paymentMethod: { type: "string" },
      place: { type: "string" },
      rawSender: { type: "string" },
      rawSubject: { type: "string" },
      review: { type: "boolean" },
      sourceMetadata: { type: "object" },
      threadId: { type: "string" },
      usage: { type: "string", maxLength: 32 },
    },
    required: ["gmailMessageId", "confidence"],
  },
};

/** `asset_manager_import_payment.items[]` の入力定義。 */
const ITEM_SCHEMA: Schema = {
  props: { amount: { type: "integer", min: 1 }, name: { type: "string" }, quantity: { type: "number", min: Number.MIN_VALUE } },
  required: ["name", "amount"],
};

/** 契約に反する点を文章で返す（空なら範囲内）。 */
function violations(schema: Schema, args: Record<string, unknown>, path = ""): string[] {
  const out: string[] = [];
  for (const key of schema.required ?? []) if (!(key in args)) out.push(`${path}${key} が必須`);
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined) continue; // JSON.stringify で落ちるので送られない
    const prop = schema.props[key];
    if (!prop) {
      out.push(`${path}${key} は入力に無い（additionalProperties: false）`);
      continue;
    }
    const label = `${path}${key}`;
    const nullable = prop.type.startsWith("nullable-");
    if (value === null) {
      if (!nullable) out.push(`${label} はnullを受け付けない`);
      continue;
    }
    const base = nullable ? prop.type.slice("nullable-".length) : prop.type;
    if (base === "string") {
      if (typeof value !== "string") out.push(`${label} は文字列`);
      else {
        if (prop.enum && !prop.enum.includes(value)) out.push(`${label} は ${prop.enum.join("/")} のいずれか`);
        if (prop.maxLength !== undefined && value.length > prop.maxLength) out.push(`${label} は${prop.maxLength}文字以内`);
        if (prop.pattern && !prop.pattern.test(value)) out.push(`${label} が形式に合わない`);
      }
    } else if (base === "integer" || base === "number") {
      if (typeof value !== "number" || (base === "integer" && !Number.isInteger(value))) out.push(`${label} は${base === "integer" ? "整数" : "数値"}`);
      else {
        if (prop.min !== undefined && value < prop.min) out.push(`${label} は${prop.min}以上`);
        if (prop.max !== undefined && value > prop.max) out.push(`${label} は${prop.max}以下`);
      }
    } else if (base === "boolean") {
      if (typeof value !== "boolean") out.push(`${label} は真偽値`);
    } else if (base === "array") {
      if (!Array.isArray(value)) out.push(`${label} は配列`);
      else if (key === "items") {
        if (value.length < 1 || value.length > 100) out.push(`${label} は1〜100件`);
        value.forEach((item, i) => out.push(...violations(ITEM_SCHEMA, item as Record<string, unknown>, `${label}[${i}].`)));
      }
    } else if (base === "object") {
      if (typeof value !== "object" || Array.isArray(value)) out.push(`${label} はオブジェクト`);
    }
  }
  return out;
}

function assertValid(tool: string, args: Record<string, unknown>) {
  const schema = SCHEMAS[tool];
  assert.ok(schema, `${tool} の入力定義が表に無い`);
  assert.deepEqual(violations(schema, args), [], `${tool} の引数が契約に反する`);
}

describe("契約の検証関数そのもの", () => {
  it("範囲外・未知の項目・必須の欠けを検出する", () => {
    assert.ok(violations(SCHEMAS.aide_tasks, { status: "done" }).length > 0);
    assert.ok(violations(SCHEMAS.aide_tasks, { limit: 101 }).length > 0);
    assert.ok(violations(SCHEMAS.aide_schedule, { days: 15 }).length > 0);
    assert.ok(violations(SCHEMAS.aide_schedule, { foo: 1 }).length > 0);
    assert.ok(violations(SCHEMAS.aide_create_task, { title: "x" }).length > 0);
  });
});

describe("読み取りの呼び出し（引数は入力の範囲内）", () => {
  it("ダッシュボードの予定（今日は3日ぶん・前後の日は offsetDays）", () => {
    assertValid("aide_schedule", { days: 3 });
    for (const offset of [-7, 7]) assertValid("aide_schedule", { days: 1, offsetDays: offset });
  });
  it("メールのサブスク提案の照合（#884。引数なし＝解約済みを除く全件）", () => {
    assertValid("asset_manager_subscriptions", {});
  });
  it("メールの紐づけ候補（予定は前後2週間・タスクは未完了60件）", () => {
    assertValid("aide_schedule", { offsetDays: -7, days: 14 });
    assertValid("aide_tasks", { status: "open", limit: 60 });
  });
  it("チャットに添える今日の状態（#1149。予定は今日から3日ぶん・タスクは未完了60件）", () => {
    assertValid("aide_schedule", { days: 3 });
    assertValid("aide_tasks", { status: "open", limit: 60 });
  });
  it("メールからの予定作成の前後確認（同じ日を1日ぶん）", () => {
    assertValid("aide_schedule", { date: "2026-11-12", days: 1 });
    assertValid("aide_schedule", { date: undefined, days: 1 });
  });
  it("引数なしの道具（天気・残高）", () => {
    assertValid("aide_weather", {});
    assertValid("aide_balances", {});
  });
});

describe("カード引き落とし見込みの呼び出し（#910）", () => {
  it("読み取りは days 1〜62", () => {
    assertValid("asset_manager_card_withdrawals", { days: 62 });
  });
  it("上書きの引数は入力の範囲内（長いメールIDでも冪等キーは191字以内）", () => {
    const check = { status: "mismatch" as const, cardId: 3, cardName: "三井住友ゴールドVISA", paymentDate: "2026-11-26", displayedAmount: 193731, mailAmount: 184591, source: "estimate" as const };
    assertValid("asset_manager_confirm_card_withdrawal", cardConfirmArgs(check, "18c3f0a1b2d4e5f6"));
    assertValid("asset_manager_confirm_card_withdrawal", cardConfirmArgs(check, "x".repeat(400)));
  });
});

describe("書き込みの呼び出し（toolCallFor が作る引数は入力の範囲内）", () => {
  const mail = { messageId: "m-1", subject: "【請求】10月分", from: "billing@example.com", receivedAt: 0 };
  const build = (kind: string, fields: Record<string, unknown>) => {
    const suggestion = normalizeSuggestion(kind, fields, "理由", 0.8);
    assert.ok(suggestion, `${kind} の提案を作れる`);
    const call = toolCallFor(suggestion, mail, "user-1");
    assert.ok(call.ok, `${kind} の呼び出しを作れる`);
    return call;
  };

  it("タスク（idempotencyKey必須）", () => {
    const call = build("task", { title: "支払う", due: "2026-11-14", memo: "要点" });
    assert.equal(call.tool, "aide_create_task");
    assertValid(call.tool, call.args);
  });
  it("タスク（時刻・予定日つき。時刻はタイムゾーン付きの日時で送る。#927）", () => {
    const call = build("task", { title: "受け取る", due: "2026-11-15", dueTime: "18:00", planned: "2026-11-14", plannedTime: "09:30", memo: "要点" });
    assertValid(call.tool, call.args);
    assert.equal(call.args.due, "2026-11-15T18:00:00+09:00");
    assert.equal(call.args.planned, "2026-11-14T09:30:00+09:00");
    assert.match(String(call.args.memo), /^要点/);
  });
  it("予定（時刻あり・終日）", () => {
    for (const fields of [
      { title: "打ち合わせ", date: "2026-11-12", startTime: "10:00", endTime: "11:00", location: "会議室" },
      { title: "終日の予定", date: "2026-11-12" },
    ]) {
      const call = build("event", fields);
      assert.equal(call.tool, "aide_create_event");
      assertValid(call.tool, call.args);
    }
  });
  it("家計簿（品目あり・外貨・使用量。review: true）", () => {
    for (const fields of [
      { name: "電気料金", amount: 8420, date: "2026-11-05", usage: "258kWh" },
      { place: "スーパー", date: "2026-11-05", time: "12:30", items: [{ name: "牛乳", amount: 200, quantity: 2 }] },
      { name: "ChatGPT", amount: 3000, date: "2026-11-05", originalAmount: 20, originalCurrency: "USD" },
    ]) {
      const call = build("payment", fields);
      assert.equal(call.tool, "asset_manager_import_payment");
      assert.equal(call.args.review, true);
      assertValid(call.tool, call.args);
    }
  });
  it("予定の削除（確認用は dryRun: true・実行用は対象の3項目だけ）", () => {
    assertValid("aide_delete_event", { eventId: "e1", calendarId: "c1", title: "予定", dryRun: true });
    assertValid("aide_delete_event", { eventId: "e1", calendarId: "c1", title: "予定" });
  });
});

describe("電気・ガスの請求のクラシオへの反映の呼び出し（#1100）", () => {
  const bill = normalizeUtilityBill({ kind: "gas", billingMonth: "2026-11", amountYen: 2648, usageValue: 12, usageUnit: "m3", planName: "ガス", sourceLabel: "はぴeみる電", confidence: 0.9 })!;
  it("読み取り（契約候補・月で引く・メールIDで引く）", () => {
    assertValid("kurashio_utility_bill_contracts", { kind: "electricity" });
    assertValid("kurashio_get_utility_bill", { kind: "electricity", contractKey: "k1", billingMonth: "2026-11" });
  });
  it("登録（使用量あり・なし。受信日付き）", () => {
    assertValid("kurashio_import_utility_bill", importArgs(bill, "k1", "msg-1", Date.parse("2026-11-05T09:12:00+09:00")));
    assertValid("kurashio_import_utility_bill", importArgs({ ...bill, usageValue: null, usageUnit: null, planName: null, sourceLabel: null }, "k1", "msg-1", null));
  });
});
