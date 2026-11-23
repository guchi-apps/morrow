import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { NATIVE_BADGE_HANDLER, normalizeBadgeCount } from "@/lib/app-badge";

describe("アプリアイコンのバッジ（#1144）", () => {
  it("件数は0以上の整数・上限9999に丸める", () => {
    assert.equal(normalizeBadgeCount(12), 12);
    assert.equal(normalizeBadgeCount(3.9), 3);
    assert.equal(normalizeBadgeCount(-5), 0);
    assert.equal(normalizeBadgeCount(100000), 9999);
  });

  it("数でない値・非有限はnull", () => {
    for (const value of ["3", null, undefined, NaN, Infinity, {}]) {
      assert.equal(normalizeBadgeCount(value), null);
    }
  });

  it("殻（Swift）の口の名前と一致する", () => {
    const swift = readFileSync(new URL("../ios/Morrow/BadgeProvider.swift", import.meta.url), "utf8");
    assert.match(swift, new RegExp(`handlerName = "${NATIVE_BADGE_HANDLER}"`));
  });
});
