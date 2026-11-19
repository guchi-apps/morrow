import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { NATIVE_LOCATION_HANDLER, readNativeLocation } from "@/lib/geolocation";
import { ForecastFetchError, isRetryableStatus, withOneRetry } from "@/lib/weather/open-meteo";

describe("readNativeLocation（iOSの殻の返事。#1087）", () => {
  it("座標が読めれば ok", () => {
    assert.deepEqual(readNativeLocation({ status: "ok", latitude: 34.74, longitude: 135.57, accuracy: 65 }), {
      status: "ok",
      latitude: 34.74,
      longitude: 135.57,
    });
  });

  it("拒否・失敗はそのまま返す（ブラウザの経路へ落とさない）", () => {
    assert.deepEqual(readNativeLocation({ status: "denied" }), { status: "denied" });
    assert.deepEqual(readNativeLocation({ status: "failed" }), { status: "failed" });
  });

  it("形の読めない値・範囲外の座標は null（ブラウザの経路へ落とす）", () => {
    for (const value of [
      null,
      undefined,
      "ok",
      {},
      { status: "ok" },
      { status: "ok", latitude: "34", longitude: 135 },
      { status: "ok", latitude: 91, longitude: 135 },
      { status: "ok", latitude: 34, longitude: -181 },
      { status: "ok", latitude: Number.NaN, longitude: 135 },
      { status: "granted" },
    ]) {
      assert.equal(readNativeLocation(value), null, JSON.stringify(value));
    }
  });

  it("口の名前がSwift側と一致する", () => {
    const swift = readFileSync(new URL("../ios/Morrow/LocationProvider.swift", import.meta.url), "utf8");
    assert.match(swift, new RegExp(`static let handlerName = "${NATIVE_LOCATION_HANDLER}"`));
  });
});

describe("Open-Meteoの取り直し（#1087）", () => {
  it("429と5xxだけを取り直す", () => {
    assert.equal(isRetryableStatus(429), true);
    assert.equal(isRetryableStatus(500), true);
    assert.equal(isRetryableStatus(503), true);
    assert.equal(isRetryableStatus(400), false);
    assert.equal(isRetryableStatus(404), false);
  });

  it("1回目の通信失敗は取り直して成功を返す", async () => {
    let calls = 0;
    const value = await withOneRetry(async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("fetch failed");
      return "ok";
    }, 0);
    assert.equal(value, "ok");
    assert.equal(calls, 2);
  });

  it("取り直しても失敗すれば投げる（2回まで）", async () => {
    let calls = 0;
    await assert.rejects(
      withOneRetry(async () => {
        calls += 1;
        throw new ForecastFetchError("503", true);
      }, 0),
    );
    assert.equal(calls, 2);
  });

  it("取り直す価値の無い失敗は1回で投げる", async () => {
    let calls = 0;
    await assert.rejects(
      withOneRetry(async () => {
        calls += 1;
        throw new ForecastFetchError("400", false);
      }, 0),
    );
    assert.equal(calls, 1);
  });
});
