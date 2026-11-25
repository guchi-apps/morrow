import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { HermesLink } from "../hermes-bridge/hermes-link.ts";
import { createBridgeServer } from "../hermes-bridge/server.ts";
import { createSkillStore, isAllowedSkillsArg, parseBundledManifest, SkillNotFoundError, SkillRejectedError } from "../hermes-bridge/skills.ts";
import {
  descriptionOf,
  detectSensitive,
  hasBlockingIssue,
  opsFromPayload,
  parseInstalledSkillsBody,
  parsePendingSkillsBody,
  validatePendingSkill,
  type PendingSkill,
} from "@/lib/hermes/skill-core";

/** Hermesが作るスキルの確認・承認（#1154）。 */

const GOOD = "---\nname: weekly-report\ndescription: 週報をまとめる手順\n---\n# 手順\n1. 予定を読む\n";

function skillWith(content: string, name = "weekly-report"): Pick<PendingSkill, "ops"> {
  return { ops: opsFromPayload({ action: "create", name, content }) };
}

describe("検証", () => {
  it("説明が60字以内・名前が正しければ通る", () => {
    assert.deepEqual(validatePendingSkill(skillWith(GOOD)), []);
  });
  it("説明が61字なら断る・説明が無くても断る", () => {
    const long = `---\nname: x\ndescription: ${"あ".repeat(61)}\n---\n本文`;
    assert.equal(hasBlockingIssue(validatePendingSkill(skillWith(long))), true);
    assert.equal(hasBlockingIssue(validatePendingSkill(skillWith("本文だけ"))), true);
    assert.equal(hasBlockingIssue(validatePendingSkill(skillWith(`---\ndescription: ${"あ".repeat(60)}\n---\nx`))), false);
  });
  it("名前・パスが不正なら断る", () => {
    assert.equal(hasBlockingIssue(validatePendingSkill(skillWith(GOOD, "Bad Name"))), true);
    const traversal = { ops: opsFromPayload({ action: "write_file", name: "ok", file_path: "../x", file_content: "a" }) };
    assert.equal(hasBlockingIssue(validatePendingSkill(traversal)), true);
  });
  it("本文が長すぎる・操作が読めないと断る", () => {
    assert.equal(hasBlockingIssue(validatePendingSkill(skillWith(`${GOOD}${"a".repeat(20_001)}`))), true);
    assert.equal(hasBlockingIssue(validatePendingSkill({ ops: [] })), true);
  });
  it("batchは操作ごとに読む", () => {
    const ops = opsFromPayload({ action: "batch", operations: [{ action: "create", name: "a", content: GOOD }, { action: "bogus", name: "b" }, { action: "delete", name: "c" }] });
    assert.deepEqual(ops.map((op) => op.action), ["create", "delete"]);
  });
  it("descriptionの引用符を外す", () => {
    assert.equal(descriptionOf("---\ndescription: 'テスト'\n---\n"), "テスト");
    assert.equal(descriptionOf("説明なし"), null);
  });
});

describe("個人情報らしき文字列", () => {
  it("電話・メール・カード・トークンを拾う", () => {
    const hits = detectSensitive("連絡は 090-1234-5678 か a@example.com、カード 1234 5678 9012 3456、password: hunter2");
    assert.deepEqual([...new Set(hits.map((h) => h.kind))].sort(), ["card", "email", "phone", "secret"]);
  });
  it("普通の手順文では拾わない", () => {
    assert.deepEqual(detectSensitive("毎週金曜に予定を読んで3行でまとめる。2026-11-24 の分も含める。"), []);
  });
});

describe("応答の形", () => {
  it("保留の一覧: 1件でも形が違えば null", () => {
    const item = { id: "0a1b2c3d", origin: "foreground", createdAt: 1, summary: "s", ops: [{ action: "create", name: "a", content: GOOD }], diff: null, touchesBundled: false };
    assert.equal(parsePendingSkillsBody({ pending: [item] })?.pending[0].ops[0].content, GOOD);
    assert.equal(parsePendingSkillsBody({ pending: [{ ...item, id: "../x" }] }), null);
    assert.equal(parsePendingSkillsBody({ pending: [{ ...item, origin: "x" }] }), null);
  });
  it("登録済み: 名前の形が違えば null", () => {
    assert.equal(parseInstalledSkillsBody({ skills: [{ name: "Bad Name", description: "", bundled: false, updatedAt: null }] }), null);
  });
});

describe("ブリッジのスキル管理", () => {
  function fakeLink(calls: string[], outputs: Record<string, string>): () => Promise<HermesLink> {
    return async () => ({
      async rpc(method, params) {
        if (method === "session.create") return { session_id: "live" };
        if (method === "command.dispatch") {
          calls.push(`${params.name} ${params.arg}`);
          return { type: "exec", output: outputs[String(params.arg)] ?? "" };
        }
        return {};
      },
      reply() {},
      onEvent() {},
      onServerRequest() {},
      onClose() {},
      close() {},
    });
  }

  async function setup() {
    const home = await mkdtemp(join(tmpdir(), "morrow-skills-"));
    await mkdir(join(home, "pending", "skills"), { recursive: true });
    await mkdir(join(home, "skills", "mine"), { recursive: true });
    await mkdir(join(home, "skills", "cat", "builtin"), { recursive: true });
    await writeFile(join(home, "skills", ".bundled_manifest"), "builtin:abc\n");
    await writeFile(join(home, "skills", "mine", "SKILL.md"), GOOD);
    await writeFile(join(home, "skills", "cat", "builtin", "SKILL.md"), GOOD);
    return home;
  }

  async function putPending(home: string, id: string, createdAtSec: number, payload: unknown) {
    await writeFile(join(home, "pending", "skills", `${id}.json`), JSON.stringify({ id, summary: "要約", origin: "foreground", created_at: createdAtSec, payload }));
  }

  it("引数の許可は pending・diff・approve・reject（8桁hex）だけ", () => {
    for (const ok of ["pending", "diff 0a1b2c3d", "approve 0a1b2c3d", "reject 0a1b2c3d"]) assert.equal(isAllowedSkillsArg(ok), true);
    for (const ng of ["approve all", "approve 0a1b2c3d x", "mode off", "approve ../1234", "pending extra", ""]) assert.equal(isAllowedSkillsArg(ng), false);
  });

  it("保留を読み、同梱スキルへの変更を印付けし、7日超は消す", async () => {
    const home = await setup();
    try {
      const now = Date.now();
      await putPending(home, "0a1b2c3d", now / 1000 - 60, { action: "create", name: "weekly-report", content: GOOD });
      await putPending(home, "1a1b2c3d", now / 1000 - 30, { action: "patch", name: "builtin", old_string: "a", new_string: "b" });
      await putPending(home, "2a1b2c3d", now / 1000 - 8 * 86400, { action: "create", name: "old", content: GOOD });
      const calls: string[] = [];
      const store = createSkillStore({ hermesHome: home, connect: fakeLink(calls, { "diff 0a1b2c3d": "DIFF" }), now: () => now });
      const list = await store.listPending();
      assert.deepEqual(list.map((s) => [s.id, s.touchesBundled, s.diff]), [["0a1b2c3d", false, "DIFF"], ["1a1b2c3d", true, ""]]);
      assert.deepEqual(await readdir(join(home, "pending", "skills")), ["0a1b2c3d.json", "1a1b2c3d.json"]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("承認はApprovedが返ったときだけ成功、却下で保留が消える、無いidは404相当", async () => {
    const home = await setup();
    try {
      await putPending(home, "0a1b2c3d", Date.now() / 1000, { action: "create", name: "weekly-report", content: GOOD });
      await putPending(home, "1a1b2c3d", Date.now() / 1000, { action: "create", name: "x", content: GOOD });
      const calls: string[] = [];
      const store = createSkillStore({ hermesHome: home, connect: fakeLink(calls, { "approve 0a1b2c3d": "Approved 1 skills write(s).", "approve 1a1b2c3d": "failed", "reject 1a1b2c3d": "" }) });
      await store.approve("0a1b2c3d");
      await assert.rejects(store.approve("1a1b2c3d"), SkillRejectedError);
      await assert.rejects(store.approve("ffffffff"), SkillNotFoundError);
      await assert.rejects(store.approve("../etc"), SkillNotFoundError);
      await store.discard("1a1b2c3d");
      assert.equal((await readdir(join(home, "pending", "skills"))).includes("1a1b2c3d.json"), false);
      assert.ok(calls.every((c) => c.startsWith("skills ")));
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("登録済みの一覧と削除（同梱は削除できない）", async () => {
    const home = await setup();
    try {
      const store = createSkillStore({ hermesHome: home, connect: fakeLink([], {}) });
      const installed = await store.listInstalled();
      assert.deepEqual(installed.map((s) => [s.name, s.bundled, s.description]), [["mine", false, "週報をまとめる手順"], ["builtin", true, "週報をまとめる手順"]]);
      await assert.rejects(store.removeInstalled("builtin"), SkillRejectedError);
      await assert.rejects(store.removeInstalled("nothing"), SkillNotFoundError);
      await assert.rejects(store.removeInstalled("../mine"), SkillNotFoundError);
      await store.removeInstalled("mine");
      assert.deepEqual((await store.listInstalled()).map((s) => s.name), ["builtin"]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("manifestから同梱の名前を読む", () => {
    assert.deepEqual([...parseBundledManifest("a:1\n\nb:2\r\n")], ["a", "b"]);
  });
});

describe("ブリッジのHTTP口", () => {
  it("認証を通した上で、保留の一覧・承認・削除が動き、失敗の種類が区別される", async () => {
    const calls: string[] = [];
    const store = {
      listPending: async () => [],
      approve: async (id: string) => {
        calls.push(`approve ${id}`);
        if (id === "ffffffff") throw new SkillNotFoundError("x");
        if (id === "eeeeeeee") throw new SkillRejectedError("拒否");
      },
      discard: async (id: string) => void calls.push(`discard ${id}`),
      listInstalled: async () => [],
      removeInstalled: async (name: string) => {
        if (name === "builtin") throw new SkillRejectedError("同梱");
      },
    };
    const server = createBridgeServer({ token: "t", allowedIps: ["1.1.1.1"], connect: async () => { throw new Error("no"); }, skills: store });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const call = (method: string, path: string, auth = true) =>
      fetch(`http://127.0.0.1:${port}${path}`, { method, headers: auth ? { authorization: "Bearer t", "x-forwarded-for": "1.1.1.1" } : {} });
    try {
      assert.equal((await call("GET", "/skills/pending", false)).status, 401);
      assert.deepEqual(await (await call("GET", "/skills/pending")).json(), { pending: [] });
      assert.equal((await call("POST", "/skills/pending/0a1b2c3d/approve")).status, 200);
      assert.equal((await call("POST", "/skills/pending/0a1b2c3d/discard")).status, 200);
      assert.equal((await call("POST", "/skills/pending/ffffffff/approve")).status, 404);
      assert.equal((await call("POST", "/skills/pending/eeeeeeee/approve")).status, 409);
      assert.equal((await call("POST", "/skills/pending/zzzz/approve")).status, 404); // 形が違うidはルートに当たらない
      assert.equal((await call("DELETE", "/skills/installed/builtin")).status, 409);
      assert.equal((await call("DELETE", "/skills/installed/mine")).status, 200);
      assert.deepEqual(calls, ["approve 0a1b2c3d", "discard 0a1b2c3d", "approve ffffffff", "approve eeeeeeee"]);
    } finally {
      server.close();
    }
  });

  it("スキルの口が未設定なら503", async () => {
    const server = createBridgeServer({ token: "t", allowedIps: ["1.1.1.1"], connect: async () => { throw new Error("no"); } });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/skills/installed`, { headers: { authorization: "Bearer t", "x-forwarded-for": "1.1.1.1" } });
      assert.equal(response.status, 503);
    } finally {
      server.close();
    }
  });
});
