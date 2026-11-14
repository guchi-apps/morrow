import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeSuggestion, toolCallFor } from "@/lib/mail/suggest-core";

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
  it("メールからの予定作成の前後確認（同じ日を1日ぶん）", () => {
    assertValid("aide_schedule", { date: "2026-11-12", days: 1 });
    assertValid("aide_schedule", { date: undefined, days: 1 });
  });
  it("引数なしの道具（天気・残高）", () => {
    assertValid("aide_weather", {});
    assertValid("aide_balances", {});
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
