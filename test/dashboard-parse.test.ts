/**
 * ダッシュボードの天気・予定の読み替え（#573）と、MCPの応答本文の読み取り。
 *
 * 「取得できなかった」と「無い」を混ぜないこと（#214）を中心に固定する。応答の形は
 * 2026-10-19に本番のAIDEから取った `aide_weather`・`aide_schedule` の実物に合わせてある。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseSchedule, parseWeather } from "../src/lib/dashboard/parse.ts";
import { readMcpBody } from "../src/lib/mcp/rpc-body.ts";

const WEATHER_OK = {
  state: "ok",
  stale: false,
  reason: null,
  data: {
    today: { date: "2026-10-19", summary: "雨（強）", temperatureMax: 25.8, temperatureMin: 18.4, precipitationProbabilityMax: 100 },
    tomorrow: { date: "2026-10-20", summary: "雨（強）", temperatureMax: 26.4, temperatureMin: 20.1, precipitationProbabilityMax: 89 },
    attribution: "Weather data by Open-Meteo.com (CC BY 4.0)",
  },
};

const SCHEDULE_OK = {
  configured: true,
  complete: true,
  sources: { googleConnected: true },
  days: [
    {
      date: "2026-10-19",
      events: [
        { title: "出張（門真）", allDay: false, startTime: "07:45", endTime: "17:15", calendarName: "仕事", outcome: null, url: "https://www.google.com/calendar/event?eid=x" },
        { title: "風呂", allDay: false, startTime: "00:26", endTime: "00:40", calendarName: "活動記録", outcome: null, url: "javascript:alert(1)" },
        { title: "祝日", allDay: true, startTime: null, endTime: null, calendarName: null, outcome: null },
        { title: "飲み会", allDay: false, startTime: "19:00", endTime: "21:00", outcome: "CANCELED" },
      ],
      travels: [{ title: "高槻市 → 大日", startTime: "06:42", endTime: "07:09" }],
      tasks: [],
      reminders: [{ title: "普通ごみ", time: "08:30", category: "ゴミの日" }],
      freeSlots: [{ from: "18:24", to: "19:00", minutes: 36 }, { from: "bad", to: "22:00" }],
    },
  ],
};

describe("parseWeather", () => {
  it("今日・明日の予報を読む", () => {
    const view = parseWeather(WEATHER_OK);
    assert.equal(view.status, "ok");
    if (view.status !== "ok") return;
    assert.deepEqual(view.today, { date: "2026-10-19", summary: "雨（強）", max: 25.8, min: 18.4, pop: 100 });
    assert.equal(view.tomorrow?.pop, 89);
    assert.equal(view.stale, false);
  });

  it("地点（location）は返っていれば読み、無ければnull（#586。AIDEの対応前）", () => {
    const withLocation = parseWeather({ ...WEATHER_OK, location: { name: "高槻市", latitude: 34.85, longitude: 135.62 } });
    assert.ok(withLocation.status === "ok");
    assert.deepEqual(withLocation.location, { name: "高槻市", latitude: 34.85, longitude: 135.62 });

    const before = parseWeather(WEATHER_OK);
    assert.ok(before.status === "ok");
    assert.equal(before.location, null);

    // 範囲外の座標は捨て、名前だけ使う
    const broken = parseWeather({ ...WEATHER_OK, location: { name: "高槻市", latitude: 200, longitude: "x" } });
    assert.ok(broken.status === "ok");
    assert.deepEqual(broken.location, { name: "高槻市", latitude: null, longitude: null });
  });

  it("state が ok 以外は「予報が無い」で、失敗とも天気とも別にする", () => {
    assert.deepEqual(parseWeather({ state: "missing", reason: "未同期" }), { status: "unavailable", reason: "未同期" });
  });

  it("形が読めない応答は failed", () => {
    assert.equal(parseWeather(null).status, "failed");
    assert.equal(parseWeather({ state: "ok", data: {} }).status, "failed");
  });

  it("明日が null（深夜0時台）でも今日は出す", () => {
    const view = parseWeather({ ...WEATHER_OK, data: { ...WEATHER_OK.data, tomorrow: null } });
    assert.equal(view.status === "ok" && view.tomorrow, null);
  });
});

describe("parseSchedule", () => {
  it("予定・移動・リマインドを時刻順に並べ、終日を先頭に置く", () => {
    const view = parseSchedule(SCHEDULE_OK);
    assert.equal(view.status, "ok");
    if (view.status !== "ok") return;
    assert.deepEqual(
      view.items.map((item) => [item.start, item.title]),
      [
        [null, "祝日"],
        ["00:26", "風呂"],
        ["06:42", "高槻市 → 大日"],
        ["07:45", "出張（門真）"],
        ["08:30", "普通ごみ"],
        ["19:00", "飲み会"],
      ],
    );
    assert.equal(view.items.find((item) => item.title === "飲み会")?.outcome, "CANCELED");
  });

  it("リンクは http(s) だけ通す", () => {
    const view = parseSchedule(SCHEDULE_OK);
    if (view.status !== "ok") return assert.fail();
    assert.equal(view.items.find((item) => item.title === "風呂")?.url, null);
    assert.match(view.items.find((item) => item.title === "出張（門真）")?.url ?? "", /^https:/);
  });

  it("空き時間は形の正しいものだけ", () => {
    const view = parseSchedule(SCHEDULE_OK);
    assert.deepEqual(view.status === "ok" && view.free, [{ from: "18:24", to: "19:00" }]);
  });

  it("未設定・一部失敗・未接続を「予定なし」と混ぜない", () => {
    assert.deepEqual(parseSchedule({ configured: false }), { status: "not_configured" });

    const partial = parseSchedule({ configured: true, complete: false, days: [{ events: [] }] });
    assert.equal(partial.status === "ok" && partial.partial, true);

    const google = parseSchedule({ configured: true, complete: true, sources: { googleConnected: false }, days: [{}] });
    assert.equal(google.status === "ok" && google.googleDisconnected, true);
  });

  it("日付が入っていない応答は failed", () => {
    assert.equal(parseSchedule({ configured: true, days: [] }).status, "failed");
    assert.equal(parseSchedule("oops").status, "failed");
  });
});

describe("readMcpBody", () => {
  it("JSONの応答をそのまま読む", () => {
    assert.deepEqual(readMcpBody('{"jsonrpc":"2.0","id":2,"result":{}}', "application/json"), { jsonrpc: "2.0", id: 2, result: {} });
  });

  it("SSEでは通知を飛ばして、id を持つ最後のメッセージを返す", () => {
    const body = [
      'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}',
      'event: message\ndata: {"jsonrpc":"2.0","id":2,\ndata: "result":{"ok":true}}',
      "",
    ].join("\n\n");
    assert.deepEqual(readMcpBody(body, "text/event-stream; charset=utf-8"), { jsonrpc: "2.0", id: 2, result: { ok: true } });
  });

  it("読めなければ null", () => {
    assert.equal(readMcpBody("<html>", "text/html"), null);
    assert.equal(readMcpBody("data: {broken", "text/event-stream"), null);
  });
});
