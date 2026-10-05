/**
 * 打ち切りでSIGTERMを無視する子は強制終了され、末尾の改行なしの行も読む（#462）。
 */
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "codex-kill-"));
const stub = join(dir, "codex-stub.sh");
process.env.CODEX_BIN = stub;
after(() => rmSync(dir, { recursive: true, force: true }));

const { runCodexExec } = await import("@/lib/codex");

describe("runCodexExec", () => {
  it("SIGTERMを無視する子もSIGKILLで落として解決する", async () => {
    writeFileSync(stub, "#!/bin/sh\ntrap '' TERM\nwhile true; do sleep 1; done\n");
    chmodSync(stub, 0o755);
    const result = await runCodexExec({
      model: "gpt-5.6-luna",
      prompt: "x",
      signal: AbortSignal.timeout(300),
    });
    assert.equal(result.interrupted, true);
  });

  it("末尾が改行で終わらない最後の行も処理する", async () => {
    writeFileSync(
      stub,
      `#!/bin/sh\ncat >/dev/null\nprintf '%s' '{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}'\n`,
    );
    chmodSync(stub, 0o755);
    const result = await runCodexExec({ model: "gpt-5.6-luna", prompt: "x", signal: new AbortController().signal });
    assert.equal(result.reply, "ok");
  });
});
