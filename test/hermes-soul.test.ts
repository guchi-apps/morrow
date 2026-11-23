import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { PROPOSE_TOOL_NAME } from "../hermes-bridge/propose-mcp.ts";
import { HERMES_PROPOSAL_TOOLS } from "@/lib/hermes/proposal-core";

/** Hermesの SOUL.md の正本（#1148）。指示文は保証にならないが、道具の表とずれていないことは固定する。 */
const soul = readFileSync(new URL("../hermes-bridge/profile/SOUL.md", import.meta.url), "utf8");

describe("hermes-bridge/profile/SOUL.md", () => {
  it("提案の道具の名前を挙げている", () => {
    assert.ok(soul.includes(PROPOSE_TOOL_NAME));
  });

  it("取り消せない書き込みの6本をすべて挙げている", () => {
    for (const tool of HERMES_PROPOSAL_TOOLS) {
      assert.ok(soul.includes(tool), `${tool} がSOULに無い`);
    }
  });

  it("実行済みと言わないことと、できないこと（シェル・ファイル・メール送信）を書いている", () => {
    assert.ok(soul.includes("実行済み"));
    for (const word of ["シェル", "ファイル", "メール"]) {
      assert.ok(soul.includes(word), `${word} の記載が無い`);
    }
  });

  it("日本語と一人称「わたし」を書いている（口調の文言そのものは固定しない）", () => {
    assert.ok(soul.includes("日本語"));
    assert.ok(soul.includes("わたし"));
  });
});
