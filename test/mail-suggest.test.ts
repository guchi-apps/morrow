import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  findExistingEvent,
  normalizeSuggestion,
  parseSuggestReply,
  plainBody,
  readToolOutcome,
  toolCallFor,
  withReceivedDate,
} from "@/lib/mail/suggest-core";
import { paymentBlocker, receiptUrl } from "@/lib/mail/payment-receipt";
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

  it("家計簿は常に確認待ち（review: true）で送り、支払先・金額が読み取れなくても送る（#781）", () => {
    const ok = toolCallFor(normalizeSuggestion("payment", { place: "Aqua Voice", name: "n", amount: 100, date: "2026-11-05" }, "", 0.8)!, mail, "u1");
    assert.ok(ok.ok);
    assert.equal(ok.tool, "asset_manager_import_payment");
    assert.equal(ok.args.review, true);
    assert.equal(ok.args.place, "Aqua Voice");
    assert.equal(ok.args.amount, 100);
    assert.equal(ok.args.gmailMessageId, "m-1");
    assert.equal(ok.args.confidence, 0.8);
    assert.equal("items" in ok.args, false);
    // 支払先・金額が無くてもAsset Managerの画面で直す。送らない項目は引数から外す（AIDEは additionalProperties: false）
    const partial = toolCallFor(normalizeSuggestion("payment", { name: "n", amount: null, date: "2026-11-05" })!, mail, "u1");
    assert.ok(partial.ok);
    assert.equal("place" in partial.args, false);
    assert.equal("amount" in partial.args, false);
    const blankPlace = normalizeSuggestion("payment", { place: "  ", name: "n", amount: 100, date: "2026-11-05" })!;
    assert.ok(blankPlace.kind === "payment" && blankPlace.fields.place === null);
  });

  it("家計簿は購入日が無ければ受信日（日本時間）で送り、受信日も無ければ送らない（#903）", () => {
    const s = normalizeSuggestion("payment", { place: "p", name: "n", amount: 100 })!;
    const received = Date.parse("2026-11-14T16:30:00Z"); // 日本時間では11/15
    const ok = toolCallFor(s, { ...mail, receivedAt: received }, "u1");
    assert.ok(ok.ok);
    assert.equal(ok.args.date, "2026-11-15");
    assert.equal(toolCallFor(s, { ...mail, receivedAt: null }, "u1").ok, false);
    // 読み取れた購入日は受信日で上書きしない
    const dated = toolCallFor(normalizeSuggestion("payment", { place: "p", name: "n", date: "2026-11-05" })!, { ...mail, receivedAt: received }, "u1");
    assert.ok(dated.ok);
    assert.equal(dated.args.date, "2026-11-05");
  });

  it("withReceivedDate は購入日が無い家計簿だけを受信日で補い、注記の印を付ける（#903）", () => {
    const result = {
      recommended: "payment" as const,
      suggestions: [
        normalizeSuggestion("payment", { place: "p", name: "n" })!,
        normalizeSuggestion("payment", { place: "q", name: "m", date: "2026-11-05" })!,
        normalizeSuggestion("event", { title: "e" })!,
      ],
    };
    const received = Date.parse("2026-11-14T03:00:00Z");
    const out = withReceivedDate(result, received);
    const [a, b, c] = out.suggestions;
    assert.ok(a.kind === "payment" && a.fields.date === "2026-11-14" && a.fields.dateEstimated === true);
    assert.ok(b.kind === "payment" && b.fields.date === "2026-11-05" && b.fields.dateEstimated === undefined);
    assert.ok(c.kind === "event" && c.fields.date === null);
    assert.equal(withReceivedDate(result, null), result);
    // 承認後の検証し直しでも印は残り、日付が無ければ印は付かない
    const again = normalizeSuggestion("payment", { place: "p", name: "n", date: "2026-11-14", dateEstimated: true })!;
    assert.ok(again.kind === "payment" && again.fields.dateEstimated === true);
    const noDay = normalizeSuggestion("payment", { place: "p", name: "n", dateEstimated: true })!;
    assert.ok(noDay.kind === "payment" && noDay.fields.dateEstimated === undefined);
    // 元の値は変えない
    assert.ok(result.suggestions[0].kind === "payment" && result.suggestions[0].fields.date === null);
  });

  it("品目は1品目1行で送り、品名が無くても品目があれば送る。時刻は日付に付ける", () => {
    const s = normalizeSuggestion("payment", {
      place: "Amazon.co.jp",
      name: "",
      amount: 2388,
      date: "2026-11-07",
      time: "14:32",
      items: [
        { name: "キッチンペーパー", amount: 698, quantity: 1 },
        { name: "単3電池 8本", amount: 1280, quantity: null },
        { name: "読めない", amount: "約500円" },
        { name: "", amount: 100 },
        { name: "配送料", amount: 410 },
      ],
    })!;
    assert.ok(s.kind === "payment");
    assert.deepEqual(s.fields.items, [
      { name: "キッチンペーパー", amount: 698, quantity: 1 },
      { name: "単3電池 8本", amount: 1280, quantity: null },
      { name: "配送料", amount: 410, quantity: null },
    ]);
    const call = toolCallFor(s, mail, "u1");
    assert.ok(call.ok);
    assert.equal(call.args.date, "2026-11-07T14:32");
    assert.equal("name" in call.args, false);
    assert.deepEqual(call.args.items, [
      { name: "キッチンペーパー", amount: 698, quantity: 1 },
      { name: "単3電池 8本", amount: 1280 },
      { name: "配送料", amount: 410 },
    ]);
  });

  it("時刻は不正な値と日付の無いときは使わない。品名・支払先・品目のどれも無ければ候補にしない", () => {
    const bad = normalizeSuggestion("payment", { name: "n", date: "2026-11-07", time: "25:00" })!;
    assert.ok(bad.kind === "payment" && bad.fields.time === null);
    const noDate = normalizeSuggestion("payment", { name: "n", time: "10:00" })!;
    assert.ok(noDate.kind === "payment" && noDate.fields.time === null);
    assert.equal(normalizeSuggestion("payment", { name: " ", amount: 100, date: "2026-11-07", items: [] }), null);
    assert.ok(normalizeSuggestion("payment", { place: "店", date: "2026-11-07" }));
  });

  it("外貨建てで円の金額が無くても送り、元の金額を付ける。予定は日付が必須", () => {
    const fx = toolCallFor(normalizeSuggestion("payment", { place: "p", name: "n", originalAmount: 9.99, originalCurrency: "usd", date: "2026-11-05" })!, mail, "u1");
    assert.ok(fx.ok);
    assert.equal(fx.args.originalCurrency, "USD");
    assert.equal("amount" in fx.args, false);
    assert.equal(toolCallFor(normalizeSuggestion("event", { title: "t" })!, mail, "u1").ok, false);
  });

  it("品名も品目も無ければ支払先を品名にする（Asset Managerは品目が無いと name 必須）", () => {
    const call = toolCallFor(normalizeSuggestion("payment", { place: "店", date: "2026-11-05" })!, mail, "u1");
    assert.ok(call.ok);
    assert.equal(call.args.name, "店");
  });
});

describe("readToolOutcome / plainBody", () => {
  it("結果を画面の文へ読み替える", () => {
    assert.equal(readToolOutcome("payment", { status: "duplicate" }).status, "duplicate");
    // レシートのidを読む（作ったレシート・取り込み済みのレシートを開く。#781）。読めないidは載せない
    assert.equal(readToolOutcome("payment", { status: "pendingReview", receiptId: 42 }).receiptId, 42);
    assert.equal(readToolOutcome("payment", { status: "duplicate", receiptId: 7 }).receiptId, 7);
    assert.equal("receiptId" in readToolOutcome("payment", { status: "pendingReview", receiptId: "42" }), false);
    assert.equal("receiptId" in readToolOutcome("payment", { status: "pendingReview", receiptId: -1 }), false);
    assert.equal(readToolOutcome("payment", { status: "error", reason: "x" }).status, "failed");
    assert.equal(readToolOutcome("task", { ok: false, reason: "未設定" }).status, "failed");
    assert.equal(readToolOutcome("event", { ok: true }).status, "done");
  });

  it("本文がHTMLだけのときはタグを落とす", () => {
    assert.equal(plainBody(null, "<p>こんにちは<script>x</script></p>").trim(), "こんにちは");
    assert.equal(plainBody("text", "<p>html</p>"), "text");
  });
});

describe("payment-receipt（#781）", () => {
  it("レシートのURLは正の整数のidだけ", () => {
    assert.equal(receiptUrl(42), "https://asset.gucchii.com/receipts/42");
    assert.equal(receiptUrl("42"), null);
    assert.equal(receiptUrl(0), null);
    assert.equal(receiptUrl(1.5), null);
  });
  it("作れない理由は購入日と、名前の手掛かりの欠け", () => {
    assert.equal(paymentBlocker({ place: "p", name: "", date: "2026-11-07", items: [] }), null);
    assert.match(paymentBlocker({ place: "p", name: "n", date: null, items: [] }) ?? "", /購入日/);
    assert.match(paymentBlocker({ place: null, name: "", date: "2026-11-07", items: [] }) ?? "", /支払先・品目/);
  });
});

describe("予定の基本情報（#908）", () => {
  const ev = (fields: Record<string, unknown>) => normalizeSuggestion("event", { title: "宿泊", date: "2026-11-20", startTime: "15:00", endTime: "10:00", ...fields })!;
  it("終了日と保存先を道具の引数へ載せ、メモは載せない", () => {
    const call = toolCallFor(ev({ endDate: "2026-11-21", calendarId: "cal-1", memo: "鍵は受付" }), mail, "u1");
    assert.ok(call.ok);
    assert.equal(call.args.endDate, "2026-11-21");
    assert.equal(call.args.calendarId, "cal-1");
    assert.equal("memo" in call.args, false);
  });
  it("終了日が開始日以前なら持たず、同日で終了が開始以前なら断る", () => {
    const same = ev({ endDate: "2026-11-20" });
    assert.ok(same.kind === "event" && same.fields.endDate === null);
    assert.equal(toolCallFor(same, mail, "u1").ok, false);
  });
  it("時刻なし（終日）では終了日・保存先のうち終了日だけを使わない", () => {
    const allDay = normalizeSuggestion("event", { title: "休み", date: "2026-11-20", endDate: "2026-11-22", calendarId: "c" })!;
    const call = toolCallFor(allDay, mail, "u1");
    assert.ok(call.ok);
    assert.equal("endDate" in call.args, false);
    assert.equal(call.args.calendarId, "c");
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

describe("タスクの期限・予定日の時刻（#907）", () => {
  it("時刻は日付があるときだけ残し、不正な時刻は捨てる", () => {
    const ok = normalizeSuggestion("task", { title: "a", due: "2026-11-15", dueTime: "18:00", planned: null, plannedTime: "10:00" }, "r", 0.5);
    assert.ok(ok && ok.kind === "task");
    assert.equal(ok.fields.dueTime, "18:00");
    assert.equal(ok.fields.planned, null);
    assert.equal(ok.fields.plannedTime, null);
    const bad = normalizeSuggestion("task", { title: "a", due: "2026-11-15", dueTime: "25:99" }, "r", 0.5);
    assert.ok(bad && bad.kind === "task");
    assert.equal(bad.fields.dueTime, null);
  });
});
