import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
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

  it("実行中のターンを操作・購読するRoute Handlerは、ターンに触れる前に持ち主を照合する（#1188）", () => {
    const base = "src/app/api/hermes/turns/[id]";
    const names = readdirSync(base);
    assert.deepEqual(names.sort(), ["approval", "clarify", "events", "interrupt"]);
    for (const name of names) {
      const source = readFileSync(`${base}/${name}/route.ts`, "utf8");
      const guard = source.indexOf("if (!isHermesProfileOwner(user)) return");
      const touch = source.search(/(ownsTurn\(id|turnLogOf<RelayEvent>\(id)/);
      assert.ok(guard !== -1 && touch !== -1 && guard < touch, name);
      assert.match(source, /PROFILE_OWNER_ONLY_MESSAGE \}, \{ status: 403 \}/, name);
    }
  });
});
