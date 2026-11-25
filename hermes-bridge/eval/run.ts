import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPrompt } from "../../src/lib/hermes/prompt-attachment.ts";
import type { BridgeEvent } from "../../src/lib/hermes/contract.ts";
import { createProposeMcpServer } from "../propose-mcp.ts";
import { connectHermes } from "../hermes-link.ts";
import { runTurn } from "../turn.ts";
import { EVAL_CASES } from "./cases.ts";
import { flagsOf, formatReport, summarizeRun, type ContextMode, type EvalCase, type ObservedTurn, type ResultEntry, type ResultFile } from "./eval-core.ts";
import { createStubAide, jstDate } from "./stub-aide.ts";

/**
 * 評価の実行（#1152）。`pnpm hermes-eval`。**subpc上で、評価専用profile（`hermes-bridge/eval/setup-profile.sh`）のHermesに対して回す。**
 * スタブAIDE・提案MCPを先に立ててから、評価専用profileのHermesを起動する（Hermesは起動時にMCPへ繋ぐため、順序が要る）。
 * 本物のMorrow profile・本物のAIDEには繋がない。既に動いているHermesを使うときだけ `HERMES_EVAL_URL`・`HERMES_EVAL_TOKEN` を渡す
 * （`HERMES_URL`＝本番のMorrow用と同じ宛先なら断る）。
 */

const HERE = dirname(fileURLToPath(import.meta.url));

interface Options {
  /** 既に動いているHermesを使うときだけ。無ければ評価専用profileのHermesをこのプロセスが起動する。 */
  externalUrl: string | null;
  externalToken: string | null;
  profile: string;
  hermesBin: string;
  hermesPort: number;
  stubPort: number;
  proposePort: number;
  only: string[] | null;
  contexts: ContextMode[];
  contextText: string | null;
  repeat: number;
  label: string;
  outDir: string;
  turnTimeoutMs: number;
}

function fail(message: string): never {
  console.error(`hermes-eval: ${message}`);
  process.exit(2);
}

function parseArgs(argv: string[]): Options {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) fail(`知らない引数 ${arg}`);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) fail(`${arg} に値が要る`);
    values.set(arg.slice(2), next);
    i += 1;
  }
  const known = new Set(["only", "context", "context-file", "repeat", "label", "out", "stub-port", "propose-port", "timeout-sec", "profile", "hermes-port"]);
  for (const key of values.keys()) if (!known.has(key)) fail(`知らない引数 --${key}`);

  const externalUrl = process.env.HERMES_EVAL_URL || null;
  const externalToken = process.env.HERMES_EVAL_TOKEN || null;
  if (externalUrl && !externalToken) fail("HERMES_EVAL_URL を使うなら HERMES_EVAL_TOKEN も要る");
  if (externalUrl && process.env.HERMES_URL && new URL(process.env.HERMES_URL).origin === new URL(externalUrl).origin) {
    fail("HERMES_EVAL_URL が本番のMorrow用Hermes（HERMES_URL）と同じ。評価専用のHermesを指すこと");
  }
  const profile = values.get("profile") ?? process.env.HERMES_EVAL_PROFILE ?? "morrow-evalstub";
  if (profile === "morrow") fail("--profile に本番の morrow は使えない（評価専用profileを指す）");

  const contextMode = values.get("context") ?? "without";
  if (!["without", "with", "both"].includes(contextMode)) fail("--context は without・with・both のどれか");
  const contexts: ContextMode[] = contextMode === "both" ? ["without", "with"] : [contextMode as ContextMode];
  let contextText: string | null = null;
  if (contexts.includes("with")) {
    const file = values.get("context-file") ?? join(HERE, "context-sample.txt");
    // {{today}}・{{tomorrow}} は実行日（日本時間）に置き換える（見本を日付に依存させない）
    contextText = readFileSync(file, "utf8").trim().replaceAll("{{today}}", jstDate(0)).replaceAll("{{tomorrow}}", jstDate(1));
    if (!contextText) fail(`${file} が空`);
  }

  const only = values.get("only")?.split(",").map((id) => id.trim()).filter(Boolean) ?? null;
  if (only) for (const id of only) if (!EVAL_CASES.some((testCase) => testCase.id === id)) fail(`知らない件 ${id}（${EVAL_CASES.map((c) => c.id).join("・")}）`);

  const num = (key: string, fallback: number) => {
    const raw = values.get(key);
    if (raw === undefined) return fallback;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1) fail(`--${key} は1以上の整数`);
    return parsed;
  };

  return {
    externalUrl,
    externalToken,
    profile,
    hermesBin: process.env.HERMES_BIN ?? "hermes",
    hermesPort: num("hermes-port", 19141),
    stubPort: num("stub-port", 19131),
    proposePort: num("propose-port", 19132),
    only,
    contexts,
    contextText,
    repeat: num("repeat", 1),
    label: values.get("label") ?? "run",
    outDir: values.get("out") ?? join(HERE, "results"),
    turnTimeoutMs: num("timeout-sec", 180) * 1000,
  };
}

function listen(server: ReturnType<typeof createStubAide>["server"], port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
}

interface HermesTarget {
  url: string;
  token: string;
  stop(): void;
}

/** 評価専用profileのHermesを起動し、`/api/ws` が繋がるまで待つ。 */
async function startHermes(options: Options): Promise<HermesTarget> {
  if (options.externalUrl && options.externalToken) {
    return { url: options.externalUrl, token: options.externalToken, stop: () => {} };
  }
  if (options.hermesPort === 19119) fail("--hermes-port が本番のMorrow用Hermes（19119）と同じ");
  const token = randomBytes(24).toString("hex");
  const url = `http://127.0.0.1:${options.hermesPort}`;
  const child: ChildProcess = spawn(
    options.hermesBin,
    ["-p", options.profile, "serve", "--isolated", "--host", "127.0.0.1", "--port", String(options.hermesPort)],
    { env: { ...process.env, HERMES_DASHBOARD_SESSION_TOKEN: token }, stdio: "ignore" },
  );
  let exited = false;
  child.once("exit", () => {
    exited = true;
  });
  const deadline = Date.now() + 90_000;
  for (;;) {
    if (exited) fail(`評価専用Hermes（profile ${options.profile}）が起動直後に終了した。setup-profile.sh を済ませたか確かめる`);
    try {
      const probe = await connectHermes({ url, token, timeoutMs: 3_000 });
      probe.close();
      break;
    } catch {
      if (Date.now() > deadline) {
        child.kill();
        fail("評価専用Hermesに90秒たっても繋がらない");
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  return { url, token, stop: () => child.kill() };
}

async function runOnce(options: Options, target: HermesTarget, testCase: EvalCase, context: ContextMode, stub: ReturnType<typeof createStubAide>): Promise<ObservedTurn> {
  stub.reset();
  stub.setDown(testCase.aideDown === true);
  const text = context === "with" ? buildPrompt([options.contextText], testCase.prompt) : testCase.prompt;

  const started = Date.now();
  const toolStarts: ObservedTurn["toolStarts"] = [];
  let approvals = 0;
  let clarifies = 0;
  let replyText = "";
  let error: string | undefined;

  let link;
  try {
    link = await connectHermes({ url: target.url, token: target.token, timeoutMs: 10_000 });
  } catch (cause) {
    return { toolStarts, stubCalls: [], approvals, clarifies, durationMs: Date.now() - started, replyText, error: `hermes_down: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
  try {
    // 承認を受けるための宣言（送らないと承認が聞かれずに取り下げられる）。セッションは件ごとに新規で、評価と分かる source を付ける
    await link.rpc("client.capabilities", { server_requests: true });
    const created = await link.rpc("session.create", { source: "morrow-eval", title: `eval ${testCase.id}` });
    const liveId = typeof created.session_id === "string" ? created.session_id : "";
    if (!liveId) throw new Error("session.create の応答にsession_idが無い");

    let handle: ReturnType<typeof runTurn> | null = null;
    const emit = (event: BridgeEvent) => {
      switch (event.type) {
        case "tool.start":
          toolStarts.push({ name: event.data.name, args: event.data.args });
          break;
        case "message.delta":
          replyText += event.data.text;
          break;
        case "message.complete":
          if (event.data.text) replyText = event.data.text;
          break;
        case "approval":
          // 評価は何も実行しない。承認は常に拒否する（`once` を通さない）
          approvals += 1;
          void handle?.respondApproval(event.data.requestId, "deny");
          break;
        case "clarify":
          // 評価では答えない。全問スキップで返し、Hermesに答えが無いときの振る舞いを見る（#1150）
          clarifies += 1;
          handle?.respondClarify(event.data.requestId, Object.fromEntries(event.data.questions.map((q) => [q.qid, null])));
          break;
        case "error":
          error = event.data.reason + (event.data.message ? `: ${event.data.message}` : "");
          break;
        default:
          break;
      }
    };
    handle = runTurn({ link, session: { liveId, storedId: liveId }, text, emit, timeoutMs: options.turnTimeoutMs });
    await handle.done;
    // 終わった直後に届く最後の呼び出し記録を待つ
    await new Promise((resolve) => setTimeout(resolve, 300));
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  } finally {
    link.close();
  }
  return { toolStarts, stubCalls: stub.calls(), approvals, clarifies, durationMs: Date.now() - started, replyText, ...(error ? { error } : {}) };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cases = EVAL_CASES.filter((testCase) => !options.only || options.only.includes(testCase.id));
  const total = cases.length * options.contexts.length * options.repeat;

  const stub = createStubAide();
  const propose = createProposeMcpServer();
  await listen(stub.server, options.stubPort);
  await listen(propose, options.proposePort);
  console.error(`hermes-eval: スタブAIDE 127.0.0.1:${options.stubPort}/mcp・提案MCP 127.0.0.1:${options.proposePort}/mcp を起動。${total}回を実行する（実Hermesを使う。サブスク枠を消費する）`);

  const target = await startHermes(options);
  // Hermesの起動時のMCP接続（`tools/list`）を拾う時間
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  console.error(`hermes-eval: 評価専用Hermes（profile ${options.profile}）に繋がった`);

  const startedAt = new Date().toISOString();
  const entries: ResultEntry[] = [];
  const result: ResultFile = { label: options.label, startedAt, contextHead: options.contextText ? options.contextText.slice(0, 80) : null, entries };
  const safeLabel = options.label.replace(/[^A-Za-z0-9._-]/g, "_");
  const outFile = join(options.outDir, `${startedAt.replace(/[:.]/g, "-")}_${safeLabel}.json`);
  mkdirSync(options.outDir, { recursive: true });

  let done = 0;
  for (let run = 1; run <= options.repeat; run += 1) {
    for (const context of options.contexts) {
      for (const testCase of cases) {
        done += 1;
        process.stderr.write(`[${done}/${total}] ${testCase.id}（${context === "with" ? "注入あり" : "注入なし"}）… `);
        const turn = await runOnce(options, target, testCase, context, stub);
        const record = summarizeRun(testCase, turn);
        entries.push({ caseId: testCase.id, context, run, record });
        const flags = flagsOf(record);
        process.stderr.write(`${(record.durationMs / 1000).toFixed(1)}秒 ${record.tools.join(" ") || "（道具なし）"}${flags.unsafe.length ? " ⚠" : ""}\n`);
        writeFileSync(outFile, JSON.stringify(result, null, 2)); // 途中で落ちても残す
      }
    }
  }

  target.stop();
  stub.server.close();
  propose.close();
  console.log(formatReport(result));
  console.log(`\n結果: ${outFile}`);

  if (stub.listCount() === 0) {
    console.error(
      "\n⚠ HermesがスタブAIDEの道具一覧を一度も引いていません。評価専用profileがスタブ（mcp_servers.aide.url）を向いていない、" +
        "またはHermesの起動後にスタブを立てたため繋がっていない可能性があります。AIDEの道具の結果が空なら `docs/hermes-route.md`「評価セット」の手順を確かめてください。",
    );
  }
  const unsafe = entries.filter((entry) => flagsOf(entry.record).unsafe.length > 0).length;
  process.exit(unsafe > 0 ? 1 : 0);
}

main().catch((cause) => {
  console.error(cause);
  process.exit(2);
});
