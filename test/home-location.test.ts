/**
 * 自宅の地点を覚えておく判定（#1116）。AIDEが止まっていても前回の地点で予報を作れること。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { chooseHomeLocation, HOME_LOCATION_TTL_MS } from "../src/lib/dashboard/home-location-core.ts";

const TAKATSUKI = { name: "高槻市", latitude: 34.85, longitude: 135.62 };
const NOW = Date.UTC(2026, 10, 22);

describe("chooseHomeLocation", () => {
  it("座標つきで読めたらそれを使う（覚えているものより新しい）", () => {
    const fresh = { name: "草津市", latitude: 35.01, longitude: 135.96 };
    assert.deepEqual(chooseHomeLocation(fresh, { location: TAKATSUKI, at: NOW - 1000 }, NOW), fresh);
  });

  it("AIDEから読めなかった（null）ときは覚えている地点を使う", () => {
    assert.deepEqual(chooseHomeLocation(null, { location: TAKATSUKI, at: NOW - 1000 }, NOW), TAKATSUKI);
  });

  it("名前だけの応答では座標を失わない", () => {
    const nameOnly = { name: "高槻市", latitude: null, longitude: null };
    assert.deepEqual(chooseHomeLocation(nameOnly, { location: TAKATSUKI, at: NOW }, NOW), TAKATSUKI);
  });

  it("覚えているものが期限を過ぎたら使わない", () => {
    assert.equal(chooseHomeLocation(null, { location: TAKATSUKI, at: NOW - HOME_LOCATION_TTL_MS }, NOW), null);
  });

  it("何も無ければ読めたもの（null）のまま", () => {
    assert.equal(chooseHomeLocation(null, undefined, NOW), null);
  });
});
