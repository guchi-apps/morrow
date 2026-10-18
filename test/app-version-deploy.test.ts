/**
 * 本番デプロイが稼働版のSHAを照合すること（#567）。
 *
 * issue-deckの新方式リリースは、`deploy.yml` に `APP_COMMIT_SHA` と `/api/app-version` が
 * 実体として含まれているかで稼働確認の可否を決める。片方だけ・コメントだけでは照合にならないため、
 * SSH先へ値を渡す経路（`env:`・`envs:`・`.env` への書き込み）と、照合のcurlが揃っていることを確かめる。
 * あわせて、ヘルスチェックが未ログインで叩けるよう `/api/app-version` が公開経路に入っていることも確かめる。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { isPublicPath } from "@/lib/supabase/public-paths";

const ROOT = join(import.meta.dirname, "..");
const deployYml = readFileSync(join(ROOT, ".github", "workflows", "deploy.yml"), "utf8");
const swJs = readFileSync(join(ROOT, "public", "sw.js"), "utf8");

/** `# …` のコメント行を除いた本文。コメントに語を書いただけで通らないようにする。 */
const deployCode = deployYml
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("#"))
  .join("\n");

describe("deploy.yml の稼働版の照合", () => {
  it("ssh-action の env: に APP_COMMIT_SHA として github.sha を渡す", () => {
    assert.match(deployCode, /^\s+APP_COMMIT_SHA: \$\{\{ github\.sha \}\}$/m);
  });

  it("envs: に APP_COMMIT_SHA を並べる（無いとSSH先に変数が存在しない）", () => {
    const envs = deployCode.match(/^\s+envs: (.+)$/m)?.[1] ?? "";
    assert.ok(envs.split(",").includes("APP_COMMIT_SHA"), envs);
  });

  it(".env へ書いてからPM2を起動し直す", () => {
    const write = deployCode.indexOf('update_env APP_COMMIT_SHA "$APP_COMMIT_SHA"');
    const restart = deployCode.indexOf("pm2 start deploy/ecosystem.config.js");
    assert.ok(write >= 0, "update_env APP_COMMIT_SHA が無い");
    assert.ok(restart > write, "PM2の起動より前に .env へ書く");
  });

  it("ヘルスチェックは /api/app-version の sha を APP_COMMIT_SHA と突き合わせる", () => {
    assert.match(deployCode, /curl -fsS "http:\/\/127\.0\.0\.1:\$\{PORT\}\/api\/app-version"/);
    assert.ok(deployCode.includes('grep -qF "\\"sha\\":\\"${APP_COMMIT_SHA}\\""'));
    // `/` へのcurlが通っただけで成功にする古い形が残っていない
    assert.doesNotMatch(deployCode, /curl -fsS -o \/dev\/null "http:\/\/127\.0\.0\.1:\$\{PORT\}\/"/);
  });
});

describe("/api/app-version の公開経路", () => {
  it("未ログインで開ける", () => {
    assert.equal(isPublicPath("/api/app-version"), true);
  });

  it("似た名前の別の経路までは開けない", () => {
    assert.equal(isPublicPath("/api/app-versions"), false);
    assert.equal(isPublicPath("/api/app"), false);
    assert.equal(isPublicPath("/api/chat"), false);
  });

  it("既存の公開経路はそのまま", () => {
    for (const path of ["/login", "/auth/signin", "/auth/callback", "/auth/native/consume"]) {
      assert.equal(isPublicPath(path), true, path);
    }
    assert.equal(isPublicPath("/"), false);
  });
});

describe("Service Worker", () => {
  it("fetch ハンドラを持たない（/api/app-version を保存しない）", () => {
    assert.doesNotMatch(swJs, /addEventListener\(\s*["']fetch["']/);
  });
});
