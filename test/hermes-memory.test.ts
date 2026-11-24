import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { HermesLink } from "../hermes-bridge/hermes-link.ts";
import { createMemoryStore, MemoryConflictError, MemoryNotFoundError, MemoryRejectedError, projectPendingMemory } from "../hermes-bridge/memory.ts";
import { createBridgeServer } from "../hermes-bridge/server.ts";
import { dispatchWriteApproval, isAllowedMemoryArg } from "../hermes-bridge/skills.ts";
import {
  hasBlockingMemoryIssue,
  memoryOpsFromPayload,
  memoryReviewText,
  memoryTitle,
  parseMemoryEntriesBody,
  parseMemoryFile,
  parsePendingMemoriesBody,
  removeEntryByText,
  serializeMemoryFile,
  validatePendingMemory,
  type PendingMemory,
} from "@/lib/hermes/memory-core";
import { PUSH_KINDS, PUSH_KIND_INFO } from "@/lib/push/kinds";

/** Hermesの記憶の確認・承認（#1155）。 */

function memoryWith(payload: unknown): Pick<PendingMemory, "ops"> {
  return { ops: memoryOpsFromPayload(payload) };
}

describe("記憶の保留の読み取りと検証", () => {
  it("単発のaddを読み、通る", () => {
    const memory = memoryWith({ action: "add", target: "user", content: "呼び名は「かず」" });
    assert.deepEqual(memory.ops, [{ action: "add", target: "user", content: "呼び名は「かず」" }]);
    assert.deepEqual(validatePendingMemory(memory), []);
    assert.equal(memoryTitle(memory), "あなたについての記憶を追加");
    assert.equal(memoryReviewText(memory), "呼び名は「かず」");
  });

  it("batchの操作を並びのまま読み、固定された対象の項目を持つ", () => {
    const memory = memoryWith({
      action: "batch",
      target: "user",
      operations: [
        { action: "remove", old_text: "古い", matched_entry: "古い呼び名" },
        { action: "add", content: "新しい呼び名" },
        { action: "bogus", content: "x" },
      ],
    });
    assert.equal(memory.ops.length, 2);
    assert.equal(memory.ops[0].matchedEntry, "古い呼び名");
    assert.equal(memory.ops[1].target, "user"); // 操作に無ければバッチのtarget
    assert.equal(memoryTitle(memory), "あなたについての記憶を削除 ほか1件");
  });

  it("空・長すぎ・区切り記号・対象なしは承認を断る", () => {
    assert.equal(hasBlockingMemoryIssue(validatePendingMemory(memoryWith({ action: "add", target: "user", content: "  " }))), true);
    assert.equal(hasBlockingMemoryIssue(validatePendingMemory(memoryWith({ action: "add", target: "user", content: "あ".repeat(301) }))), true);
    assert.equal(hasBlockingMemoryIssue(validatePendingMemory(memoryWith({ action: "add", target: "user", content: "a§b" }))), true);
    assert.equal(hasBlockingMemoryIssue(validatePendingMemory(memoryWith({ action: "remove", target: "user" }))), true);
    assert.equal(hasBlockingMemoryIssue(validatePendingMemory({ ops: [] })), true);
    assert.equal(hasBlockingMemoryIssue(validatePendingMemory(memoryWith({ action: "add", target: "user", content: "あ".repeat(300) }))), false);
  });

  it("対象が固定されていない削除は警告になる（断らない）", () => {
    const issues = validatePendingMemory(memoryWith({ action: "remove", target: "memory", old_text: "x" }));
    assert.equal(hasBlockingMemoryIssue(issues), false);
    assert.ok(issues.some((issue) => issue.level === "warning" && issue.message.includes("固定")));
  });
});

describe("記憶ファイルの書式", () => {
  // 2026-11-24にHermesの MemoryStore で add を2回した実物: `呼び名はかずさん\n§\n自宅の最寄りは草津駅`（末尾の改行なし）
  const REAL = "呼び名はかずさん\n§\n自宅の最寄りは草津駅";

  it("実物を項目へ分け、同じ書式へ戻せる", () => {
    assert.deepEqual(parseMemoryFile(REAL), ["呼び名はかずさん", "自宅の最寄りは草津駅"]);
    assert.equal(serializeMemoryFile(parseMemoryFile(REAL)), REAL);
    assert.equal(serializeMemoryFile(["1つだけ"]), "1つだけ");
    assert.equal(serializeMemoryFile([]), "");
  });
  it("空・空白だけの項目とBOMは捨てる", () => {
    assert.deepEqual(parseMemoryFile("\n§\n  \n§\nA\n§\n"), ["A"]);
    assert.deepEqual(parseMemoryFile("﻿A"), ["A"]);
    assert.deepEqual(parseMemoryFile(""), []);
  });
  it("削除は全文が一致した項目だけ（部分一致では消さない）", () => {
    const entries = ["呼び名はかずさん", "呼び名は"];
    assert.deepEqual(removeEntryByText(entries, "呼び名は"), ["呼び名はかずさん"]);
    assert.equal(removeEntryByText(entries, "呼び名"), null);
    assert.equal(removeEntryByText(entries, " "), null);
    assert.deepEqual(removeEntryByText(entries, " 呼び名はかずさん\n"), ["呼び名は"]);
  });
});

describe("ブリッジの応答のparse", () => {
  it("保留の一覧を往復できる・形が違えばnull", () => {
    const pending = [{ id: "0a1b2c3d", origin: "foreground", createdAt: 1, summary: "s", ops: [{ action: "add", target: "user", content: "x" }] }];
    const parsed = parsePendingMemoriesBody({ pending });
    assert.deepEqual(parsed?.pending[0].ops, [{ action: "add", target: "user", content: "x" }]);
    assert.equal(parsePendingMemoriesBody({ pending: [{ ...pending[0], id: "zz" }] }), null);
    assert.equal(parsePendingMemoriesBody({}), null);
  });
  it("記憶の一覧を読む・不正な置き場や空はnull", () => {
    assert.deepEqual(parseMemoryEntriesBody({ entries: [{ target: "user", text: "a" }] })?.entries, [{ target: "user", text: "a" }]);
    assert.equal(parseMemoryEntriesBody({ entries: [{ target: "other", text: "a" }] }), null);
    assert.equal(parseMemoryEntriesBody({ entries: [{ target: "user", text: " " }] }), null);
  });
});

describe("記憶のブリッジ", () => {
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
    const home = await mkdtemp(join(tmpdir(), "morrow-memory-"));
    await mkdir(join(home, "pending", "memory"), { recursive: true });
    await mkdir(join(home, "memories"), { recursive: true });
    await writeFile(join(home, "memories", "USER.md"), "呼び名はかずさん\n§\n自宅の最寄りは草津駅");
    return home;
  }

  async function putPending(home: string, id: string, createdAtSec: number, payload: unknown) {
    await writeFile(join(home, "pending", "memory", `${id}.json`), JSON.stringify({ id, summary: "要約", origin: "foreground", created_at: createdAtSec, payload }));
  }

  it("引数の許可は pending・approve・reject（8桁hex）だけ。diffや他のsubcommandは通さない", () => {
    for (const ok of ["pending", "approve 0a1b2c3d", "reject 0a1b2c3d"]) assert.equal(isAllowedMemoryArg(ok), true);
    for (const ng of ["diff 0a1b2c3d", "approve all", "approve 0a1b2c3d x", "mode off", "approval off", "approve ../1234", ""]) assert.equal(isAllowedMemoryArg(ng), false);
  });

  it("許可の外の組み合わせは接続する前に断る", async () => {
    let connected = false;
    const connect = async () => {
      connected = true;
      throw new Error("no");
    };
    await assert.rejects(dispatchWriteApproval(connect, "memory", "diff 0a1b2c3d"));
    await assert.rejects(dispatchWriteApproval(connect, "skills", "approve all"));
    assert.equal(connected, false);
  });

  it("保留を読み、7日超は消す", async () => {
    const home = await setup();
    try {
      const now = Date.now();
      await putPending(home, "0a1b2c3d", now / 1000 - 60, { action: "add", target: "user", content: "好きな色は青" });
      await putPending(home, "2a1b2c3d", now / 1000 - 8 * 86400, { action: "add", target: "user", content: "古い" });
      await writeFile(join(home, "pending", "memory", "broken.json"), "{");
      const store = createMemoryStore({ hermesHome: home, connect: fakeLink([], {}), now: () => now });
      const pending = await store.listPending();
      assert.deepEqual(pending.map((p) => p.id), ["0a1b2c3d"]);
      assert.equal(pending[0].ops[0].content, "好きな色は青");
      assert.deepEqual((await readdir(join(home, "pending", "memory"))).sort(), ["0a1b2c3d.json", "broken.json"]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("承認はHermesのapproveを呼び、適用されなければ拒否。却下はrejectで、消えなければファイルも消す", async () => {
    const home = await setup();
    try {
      await putPending(home, "0a1b2c3d", Date.now() / 1000, { action: "add", target: "user", content: "x" });
      await putPending(home, "1a1b2c3d", Date.now() / 1000, { action: "add", target: "user", content: "y" });
      await putPending(home, "2a1b2c3d", Date.now() / 1000, { action: "add", target: "user", content: "z" });
      const calls: string[] = [];
      const store = createMemoryStore({
        hermesHome: home,
        connect: fakeLink(calls, { "approve 0a1b2c3d": "Approved 1 memory write(s).", "approve 1a1b2c3d": "failed", "reject 2a1b2c3d": "" }),
      });
      await store.approve("0a1b2c3d");
      await assert.rejects(store.approve("1a1b2c3d"), MemoryRejectedError);
      await assert.rejects(store.approve("ffffffff"), MemoryNotFoundError);
      await assert.rejects(store.approve("../etc"), MemoryNotFoundError);
      await store.discard("2a1b2c3d");
      assert.deepEqual(calls, ["memory approve 0a1b2c3d", "memory approve 1a1b2c3d", "memory reject 2a1b2c3d"]);
      assert.equal((await readdir(join(home, "pending", "memory"))).includes("2a1b2c3d.json"), false);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("保存済みの一覧と、全文が一致した1項目だけの削除", async () => {
    const home = await setup();
    try {
      await writeFile(join(home, "memories", "MEMORY.md"), "メモA");
      const store = createMemoryStore({ hermesHome: home, connect: fakeLink([], {}) });
      assert.deepEqual(await store.listEntries(), [
        { target: "user", text: "呼び名はかずさん" },
        { target: "user", text: "自宅の最寄りは草津駅" },
        { target: "memory", text: "メモA" },
      ]);
      await assert.rejects(store.removeEntry("user", "呼び名"), MemoryNotFoundError); // 部分一致は消さない
      await assert.rejects(store.removeEntry("memory", "呼び名はかずさん"), MemoryNotFoundError); // 置き場違い
      await store.removeEntry("user", "呼び名はかずさん");
      assert.equal(await readFile(join(home, "memories", "USER.md"), "utf8"), "自宅の最寄りは草津駅"); // Hermesと同じ書式のまま
      await store.removeEntry("user", "自宅の最寄りは草津駅");
      assert.equal(await readFile(join(home, "memories", "USER.md"), "utf8"), "");
      assert.deepEqual((await readdir(join(home, "memories"))).filter((f) => f.endsWith(".tmp")), []); // 一時ファイルを残さない
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("記憶が一度もできていないprofileでも一覧は空で返る", async () => {
    const home = await mkdtemp(join(tmpdir(), "morrow-memory-empty-"));
    try {
      const store = createMemoryStore({ hermesHome: home, connect: fakeLink([], {}) });
      assert.deepEqual(await store.listPending(), []);
      assert.deepEqual(await store.listEntries(), []);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("保留の記録の形が違えばnull", () => {
    assert.equal(projectPendingMemory(null), null);
    assert.equal(projectPendingMemory({ id: "zz", payload: {} }), null);
  });

  it("HTTPの口は認証・id・本文の形を確かめ、失敗を区別して返す", async () => {
    const calls: string[] = [];
    const store = {
      async listPending() {
        return [];
      },
      async approve(id: string) {
        calls.push(`approve ${id}`);
        if (id === "ffffffff") throw new MemoryNotFoundError("none");
        if (id === "eeeeeeee") throw new MemoryRejectedError("no");
      },
      async discard(id: string) {
        calls.push(`discard ${id}`);
      },
      async listEntries() {
        return [{ target: "user" as const, text: "a" }];
      },
      async removeEntry(target: string, text: string) {
        calls.push(`remove ${target} ${text}`);
        if (text === "missing") throw new MemoryNotFoundError("none");
      },
    };
    const server = createBridgeServer({ token: "t", allowedIps: ["1.1.1.1"], connect: async () => { throw new Error("no"); }, memory: store });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const call = (method: string, path: string, body?: unknown, auth = true) =>
      fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: { ...(auth ? { authorization: "Bearer t", "x-forwarded-for": "1.1.1.1" } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    try {
      assert.equal((await call("GET", "/memory/pending", undefined, false)).status, 401);
      assert.deepEqual(await (await call("GET", "/memory/pending")).json(), { pending: [] });
      assert.deepEqual(await (await call("GET", "/memory/entries")).json(), { entries: [{ target: "user", text: "a" }] });
      assert.equal((await call("POST", "/memory/pending/0a1b2c3d/approve")).status, 200);
      assert.equal((await call("POST", "/memory/pending/0a1b2c3d/discard")).status, 200);
      assert.equal((await call("POST", "/memory/pending/ffffffff/approve")).status, 404);
      assert.equal((await call("POST", "/memory/pending/eeeeeeee/approve")).status, 409);
      assert.equal((await call("POST", "/memory/pending/zzzz/approve")).status, 404);
      assert.equal((await call("DELETE", "/memory/entries", { target: "user", text: "a" })).status, 200);
      assert.equal((await call("DELETE", "/memory/entries", { target: "user", text: "missing" })).status, 404);
      assert.equal((await call("DELETE", "/memory/entries", { target: "bogus", text: "a" })).status, 400);
      assert.equal((await call("DELETE", "/memory/entries", { target: "user", text: " " })).status, 400);
      assert.equal((await call("DELETE", "/memory/entries")).status, 400);
      assert.deepEqual(calls, ["approve 0a1b2c3d", "discard 0a1b2c3d", "approve ffffffff", "approve eeeeeeee", "remove user a", "remove user missing"]);
    } finally {
      server.close();
    }
  });

  it("記憶の口が未設定なら503", async () => {
    const server = createBridgeServer({ token: "t", allowedIps: ["1.1.1.1"], connect: async () => { throw new Error("no"); } });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/memory/entries`, { headers: { authorization: "Bearer t", "x-forwarded-for": "1.1.1.1" } });
      assert.equal(response.status, 503);
    } finally {
      server.close();
    }
  });
});

describe("通知の種類", () => {
  it("hermes-memory が並び、見本は /memory へ飛ぶ", () => {
    assert.ok(PUSH_KINDS.includes("hermes-memory"));
    assert.equal(PUSH_KIND_INFO["hermes-memory"].sample.url, "/memory");
  });
});

describe("記憶の削除と同時のHermesの書き込み（#1181）", () => {
  const link = async (): Promise<HermesLink> => {
    throw new Error("使わない");
  };

  async function home() {
    const dir = await mkdtemp(join(tmpdir(), "morrow-memory-race-"));
    await mkdir(join(dir, "memories"), { recursive: true });
    await writeFile(join(dir, "memories", "USER.md"), "A\n§\nB");
    return dir;
  }

  it("削除が読んだ後にHermesが項目Cを足しても、Cを消さずに最新の内容から削除する", async () => {
    const dir = await home();
    let injected = false;
    const store = createMemoryStore({
      hermesHome: dir,
      connect: link,
      beforeRemoveCommit: async () => {
        if (injected) return;
        injected = true;
        await writeFile(join(dir, "memories", "USER.md"), "A\n§\nB\n§\nC");
      },
    });
    await store.removeEntry("user", "A");
    const entries = (await store.listEntries()).map((entry) => entry.text);
    assert.deepEqual(entries, ["B", "C"]);
    await rm(dir, { recursive: true });
  });

  it("書き換えが続いて確定できなければ MemoryConflictError で、ファイルは触らない", async () => {
    const dir = await home();
    let n = 0;
    const store = createMemoryStore({
      hermesHome: dir,
      connect: link,
      beforeRemoveCommit: async () => {
        n += 1;
        await writeFile(join(dir, "memories", "USER.md"), `A\n§\nB\n§\nC${n}`);
      },
    });
    await assert.rejects(() => store.removeEntry("user", "A"), MemoryConflictError);
    assert.equal(await readFile(join(dir, "memories", "USER.md"), "utf8"), `A\n§\nB\n§\nC${n}`);
    assert.deepEqual((await readdir(join(dir, "memories"))).filter((f) => f.endsWith(".tmp")), []);
    await rm(dir, { recursive: true });
  });

  it("他の利用者が消した後（項目が既に無い）は MemoryNotFoundError", async () => {
    const dir = await home();
    const store = createMemoryStore({ hermesHome: dir, connect: link });
    await assert.rejects(() => store.removeEntry("user", "Z"), MemoryNotFoundError);
    await rm(dir, { recursive: true });
  });
});
