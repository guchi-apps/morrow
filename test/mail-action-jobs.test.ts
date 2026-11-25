import assert from "node:assert/strict";
import { test } from "node:test";

import { createActionJobs } from "../src/lib/mail/action-jobs.ts";

const tick = () => new Promise((r) => setTimeout(r, 20));

test("同じ利用者の操作は手動（submit）も自動（run）も積んだ順に1つずつ流れ、失敗しても次へ進む", async () => {
  const jobs = createActionJobs<string>();
  const log: string[] = [];
  const task = (name: string, fail = false) => async () => {
    log.push(`start:${name}`);
    await new Promise((r) => setTimeout(r, 2));
    log.push(`end:${name}`);
    if (fail) throw new Error(name);
    return name;
  };
  jobs.submit("u", "op-a", task("a"));
  const failed = jobs.run("u", task("b", true));
  const auto = jobs.run("u", task("c"));
  await assert.rejects(failed);
  assert.equal(await auto, "c");
  assert.deepEqual(log, ["start:a", "end:a", "start:b", "end:b", "start:c", "end:c"]);
});

test("同じopIdの再送は、実行中も完了後も二度実行しない", async () => {
  let clock = 0;
  const jobs = createActionJobs<number>({ ttlMs: 100, now: () => clock });
  let runs = 0;
  const task = async () => ++runs;
  assert.deepEqual(jobs.submit("u", "op", task), { state: "running" });
  assert.deepEqual(jobs.submit("u", "op", task), { state: "running" });
  await tick();
  assert.deepEqual(jobs.submit("u", "op", task), { state: "done", value: 1 });
  assert.equal(runs, 1);
  // 別の利用者の同じopIdは別物
  jobs.submit("v", "op", task);
  await tick();
  assert.equal(runs, 2);
  // 期限を過ぎれば忘れる
  clock = 100;
  assert.deepEqual(jobs.submit("u", "op", task), { state: "running" });
  await tick();
  assert.equal(runs, 3);
});

test("例外で終わった回は覚えず、再送でやり直せる", async () => {
  const jobs = createActionJobs<number>();
  let runs = 0;
  const task = async () => {
    runs += 1;
    if (runs === 1) throw new Error("x");
    return runs;
  };
  jobs.submit("u", "op", task);
  await tick();
  jobs.submit("u", "op", task);
  await tick();
  assert.deepEqual(jobs.submit("u", "op", task), { state: "done", value: 2 });
});
