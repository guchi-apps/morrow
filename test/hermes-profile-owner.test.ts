import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { isProfileOwner } from "../src/lib/hermes/profile-owner-core.ts";

describe("Hermes profileの持ち主の照合（#1181）", () => {
  it("設定したメールと（大文字小文字・空白を除いて）一致する利用者だけ通す", () => {
    assert.equal(isProfileOwner("Owner@Example.com", " owner@example.com "), true);
    assert.equal(isProfileOwner("owner@example.com", "other@example.com"), false);
  });

  it("未設定・空・メール無しは全員拒否", () => {
    assert.equal(isProfileOwner(undefined, "a@example.com"), false);
    assert.equal(isProfileOwner("", ""), false);
    assert.equal(isProfileOwner("owner@example.com", null), false);
  });

  it("記憶・スキルのRoute Handler・ページがすべて持ち主の照合を通る", () => {
    const files = [
      "src/app/api/hermes/memory/pending/[id]/route.ts",
      "src/app/api/hermes/memory/entries/route.ts",
      "src/app/api/hermes/memory/pending-count/route.ts",
      "src/app/api/hermes/skills/pending/[id]/route.ts",
      "src/app/api/hermes/skills/installed/[name]/route.ts",
    ];
    for (const file of files) assert.match(readFileSync(file, "utf8"), /denyUnlessProfileOwner\(\)/, file);
    for (const file of ["src/app/(chat)/memory/page.tsx", "src/app/(chat)/skills/page.tsx"]) {
      assert.match(readFileSync(file, "utf8"), /profileOwnerUser\(\)/, file);
    }
  });
});
