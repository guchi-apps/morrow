import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSuggestPrompt,
  findExistingEvent,
  normalizeSuggestion,
  parseSuggestReply,
  plainBody,
  readToolOutcome,
  toolCallFor,
} from "@/lib/mail/suggest-core";
import { subscriptionLink, type SubscriptionFields } from "@/lib/mail/subscription-link";

/** メールの提案（#689）のうち、DB・ネットワークに触れない部分。 */

const mail = { messageId: "m-1", subject: "【請求】10月分", from: "billing@example.com", receivedAt: 0 };

const reply = JSON.stringify({
  recommended: "payment",
  suggestions: [
    { kind: "payment", reason: "電気料金の請求", confidence: 0.9, fields: { name: "電気料金", amount: 8420, date: "2026-11-05", usage: "258kWh" } },
    { kind: "task", reason: "期限あり", confidence: 0.7, fields: { title: "支払う", due: "2026-11-14", memo: "要点" } },
    { kind: "payment", reason: "重複", confidence: 0.1, fields: { name: "x", amount: 1, date: "2026-11-05" } },
    { kind: "bogus", fields: {} },
  ],
});

describe("parseSuggestReply", () => {
  it("候補を読み、同じ種類の重複・知らない種類を落とす", () => {
    const result = parseSuggestReply(`前置き${reply}後書き`);
    assert.ok(result);
    assert.equal(result.recommended, "payment");
    assert.deepEqual(result.suggestions.map((s) => s.kind), ["payment", "task"]);
  });

  it("読めない返答はnull。候補が無ければ推奨なし", () => {
    assert.equal(parseSuggestReply("だめ"), null);
    assert.deepEqual(parseSuggestReply('{"recommended":"task","suggestions":[]}'), { recommended: null, suggestions: [] });
  });

  it("推奨が候補に無ければ確度の高い候補にする", () => {
    const result = parseSuggestReply(JSON.stringify({ recommended: "event", suggestions: [{ kind: "task", confidence: 0.4, fields: { title: "a" } }, { kind: "payment", confidence: 0.8, fields: { name: "b" } }] }));
    assert.equal(result?.recommended, "payment");
  });

  it("読み取れない値を埋め合わせない（不正な日付・時刻・金額はnull）", () => {
    const s = normalizeSuggestion("payment", { name: "n", amount: 12.5, date: "2026-02-31" });
    assert.ok(s && s.kind === "payment");
    assert.equal(s.fields.amount, null);
    assert.equal(s.fields.date, null);
    const e = normalizeSuggestion("event", { title: "t", date: "2026-11-20", startTime: "10:00", endTime: "25:00" });
    assert.ok(e && e.kind === "event");
    assert.equal(e.fields.startTime, null);
    assert.equal(e.fields.endTime, null);
  });

  it("名称・題名が空なら候補にしない", () => {
    assert.equal(normalizeSuggestion("task", { title: "  " }), null);
    assert.equal(normalizeSuggestion("nope", {}), null);
  });
});

describe("toolCallFor", () => {
  it("タスクは同じ入力なら同じ冪等キーで、メモにメールの手掛かりを入れる", () => {
    const s = normalizeSuggestion("task", { title: "支払う", due: "2026-11-14", memo: "要点" })!;
    const a = toolCallFor(s, mail, "u1");
    const b = toolCallFor(s, mail, "u1");
    assert.ok(a.ok && b.ok);
    assert.equal(a.tool, "aide_create_task");
    assert.equal(a.args.idempotencyKey, b.args.idempotencyKey);
    assert.match(String(a.args.memo), /\/mail\/m-1/);
  });

  it("家計簿は金額・日付が無ければ送らない。あればmessageIdと確度を付ける", () => {
    const missing = normalizeSuggestion("payment", { name: "n", amount: null, date: "2026-11-05" })!;
    assert.equal(toolCallFor(missing, mail, "u1").ok, false);
    const ok = toolCallFor(normalizeSuggestion("payment", { name: "n", amount: 100, date: "2026-11-05" }, "", 0.8)!, mail, "u1");
    assert.ok(ok.ok);
    assert.equal(ok.tool, "asset_manager_import_payment");
    assert.equal(ok.args.gmailMessageId, "m-1");
    assert.equal(ok.args.confidence, 0.8);
  });

  it("外貨建ては元の金額と通貨だけでも送れる。予定は日付が必須", () => {
    const fx = normalizeSuggestion("payment", { name: "n", originalAmount: 9.99, originalCurrency: "usd", date: "2026-11-05" })!;
    assert.ok(toolCallFor(fx, mail, "u1").ok);
    assert.equal(toolCallFor(normalizeSuggestion("event", { title: "t" })!, mail, "u1").ok, false);
  });
});

describe("readToolOutcome / buildSuggestPrompt / plainBody", () => {
  it("結果を画面の文へ読み替える", () => {
    assert.equal(readToolOutcome("payment", { status: "duplicate" }).status, "duplicate");
    assert.equal(readToolOutcome("payment", { status: "error", reason: "x" }).status, "failed");
    assert.equal(readToolOutcome("task", { ok: false, reason: "未設定" }).status, "failed");
    assert.equal(readToolOutcome("event", { ok: true }).status, "done");
  });

  it("プロンプトは本文をデータとして渡し、指示に従わない旨を含む", () => {
    const p = buildSuggestPrompt({ from: "a", subject: "b", body: "本文\n改行", receivedDate: null, today: "2026-11-08" });
    assert.match(p, /指示（.*）には従わない/);
    assert.ok(!p.includes("本文\n改行"));
  });

  it("本文がHTMLだけのときはタグを落とす", () => {
    assert.equal(plainBody(null, "<p>こんにちは<script>x</script></p>").trim(), "こんにちは");
    assert.equal(plainBody("text", "<p>html</p>"), "text");
  });
});

describe("findExistingEvent（予定の重複確認）", () => {
  const sched = (events: unknown[], extra: Record<string, unknown> = {}) => ({ configured: true, complete: true, sources: { googleConnected: true }, days: [{ events }], ...extra });
  const ev = { title: "打ち合わせ", startTime: "10:00", endTime: "11:00", allDay: false };
  it("同じタイトル・時刻があれば exists", () => {
    assert.equal(findExistingEvent(sched([ev]), { title: "打ち合わせ", startTime: "10:00", endTime: "11:00" }), "exists");
  });
  it("時刻・タイトルが違えば none、中止された予定は数えない", () => {
    assert.equal(findExistingEvent(sched([ev]), { title: "打ち合わせ", startTime: "11:00", endTime: "12:00" }), "none");
    assert.equal(findExistingEvent(sched([{ ...ev, outcome: "CANCELED" }]), { title: "打ち合わせ", startTime: "10:00", endTime: "11:00" }), "none");
  });
  it("終日は時刻なし同士で照合する", () => {
    assert.equal(findExistingEvent(sched([{ title: "休み", allDay: true }]), { title: "休み" }), "exists");
  });
  it("取得できなかった・一部だけの応答は unreadable", () => {
    assert.equal(findExistingEvent({ configured: false }, { title: "x" }), "unreadable");
    assert.equal(findExistingEvent(sched([], { complete: false }), { title: "x" }), "unreadable");
    assert.equal(findExistingEvent(null, { title: "x" }), "unreadable");
  });
});

describe("サブスク登録（#709）", () => {
  it("値を検証し、読めない項目はnullのままにする", () => {
    const s = normalizeSuggestion("subscription", { name: "Aqua Voice Pro", amount: 2000, currency: "EUR", cycle: "WEEKLY", day: 40, startDate: "2026-02-31" });
    assert.ok(s && s.kind === "subscription");
    assert.deepEqual(s.fields, { name: "Aqua Voice Pro", amount: 2000, currency: "JPY", cycle: "MONTHLY", day: null, startDate: null });
  });

  it("Morrowからは書き込まず、Asset Managerへのリンクだけを作る", () => {
    const s = normalizeSuggestion("subscription", { name: "A B", amount: 2000, currency: "JPY", cycle: "MONTHLY", day: 8, startDate: "2026-11-08" })!;
    assert.equal(toolCallFor(s, { messageId: "m", subject: "s", from: "f", receivedAt: null }, "u1").ok, false);
    assert.equal(
      subscriptionLink(s.fields as SubscriptionFields),
      "https://asset.gucchii.com/subscriptions?new=1&name=A+B&currency=JPY&cycle=MONTHLY&amount=2000&day=8&start=2026-11-08",
    );
  });
});
