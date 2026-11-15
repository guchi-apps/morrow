import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatWeatherContext, mentionsWeather, parseChatLocation } from "@/lib/weather/chat-context-core";
import type { Forecast } from "@/lib/weather/rain-check";

const forecast: Forecast = {
  hourly: [],
  daily: [
    { date: "2026-11-15", code: 0, max: 18.4, min: 9.2, pop: 10 },
    { date: "2026-11-16", code: 61, max: 15, min: 8, pop: 70 },
  ],
};

describe("mentionsWeather", () => {
  it("天気に関わる指示を拾う", () => {
    for (const text of ["天気は？", "明日の気温", "傘いる？", "雨降る"]) assert.equal(mentionsWeather(text), true, text);
  });
  it("関係ない指示は拾わない", () => {
    for (const text of ["予定を教えて", "タスクを追加して"]) assert.equal(mentionsWeather(text), false, text);
  });
});

describe("parseChatLocation", () => {
  it("小数2桁に丸める", () => {
    assert.deepEqual(parseChatLocation({ latitude: 34.69374, longitude: 135.50218 }), { latitude: 34.69, longitude: 135.5 });
  });
  it("読めない・範囲外はnull", () => {
    for (const value of [null, undefined, "x", [], {}, { latitude: "1", longitude: 2 }, { latitude: 91, longitude: 0 }, { latitude: NaN, longitude: 0 }]) {
      assert.equal(parseChatLocation(value), null);
    }
  });
});

describe("formatWeatherContext", () => {
  it("現在地の今日・明日の予報を添える", () => {
    const result = formatWeatherContext({ source: "here", placeName: "高槻市", forecast, today: "2026-11-15" });
    assert.match(result.prompt, /現在地（高槻市）/);
    assert.match(result.prompt, /今日（2026-11-15）: 快晴.*最高18℃/);
    assert.match(result.prompt, /明日（2026-11-16）/);
    assert.equal(result.label, "現在地（高槻市）の天気を参照しました");
  });
  it("現在地が無いときは自宅だと伝える", () => {
    const result = formatWeatherContext({ source: "home", placeName: "自宅", forecast, today: "2026-11-15" });
    assert.match(result.prompt, /現在地は分からなかった/);
    assert.match(result.label, /自宅/);
  });
  it("予報が読めない日は読めなかったと書く", () => {
    const result = formatWeatherContext({ source: "here", placeName: "現在地", forecast, today: "2030-01-01" });
    assert.match(result.prompt, /予報を読めなかった/);
  });
});
