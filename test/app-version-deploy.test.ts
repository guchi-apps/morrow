/**
 * 本番デプロイが稼働版のSHAを照合すること（#567）。
 *
 * issue-deckの新方式リリースは、`deploy.yml` が稼働版を照合するか（自前の照合か、gateへの委譲か）で
 * 稼働確認の可否を決める（issue-deck の deploy-version-check.ts）。照合はVPSのgate（app-deploy-gate）が行うため、
 * `APP_COMMIT_SHA` をgateへ渡す経路（stepの `env:`・`ssh … env` の標準入力）と `ssh … deploy` が揃っていることを確かめる。
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

describe("deploy.yml の稼働版の照合（app-deploy-gate へ委譲）", () => {
  // 第2段階（#567）から、照合はVPSのgate（/usr/local/sbin/app-deploy-gate。guchi-apps/vps#298）が行う。
  // gateは .env に APP_COMMIT_SHA があるときだけ 127.0.0.1:<PORT>/api/app-version の sha と突き合わせ、
  // 一致しなければ失敗する。ここでは deploy.yml が APP_COMMIT_SHA を gate へ渡し、deploy を呼ぶことを確かめる。
  it("Send environment variables の env: に APP_COMMIT_SHA として github.sha を渡す", () => {
    assert.match(deployCode, /^\s+APP_COMMIT_SHA: \$\{\{ github\.sha \}\}$/m);
  });

  it("APP_COMMIT_SHA と PORT を `ssh … env` の標準入力へ流す", () => {
    assert.ok(deployCode.includes('"APP_COMMIT_SHA=${APP_COMMIT_SHA}"'), "APP_COMMIT_SHA を送っていない");
    assert.ok(deployCode.includes('"PORT=3103"'), "PORT を送っていない（gateでは必須）");
    assert.match(deployCode, /\|\s*ssh -p "\$\{SSH_PORT\}" "\$\{USERNAME\}@\$\{HOST\}" env$/m);
  });

  it("env の送信のあとで deploy を呼ぶ", () => {
    const send = deployCode.indexOf('"${USERNAME}@${HOST}" env');
    const deploy = deployCode.indexOf('"${USERNAME}@${HOST}" deploy');
    assert.ok(send >= 0 && deploy > send, "env の後に deploy を呼んでいない");
  });

  it("organization共通のSSH鍵ではなくアプリ専用の鍵を使う", () => {
    assert.doesNotMatch(deployCode, /secrets\.SERVER_SSH_PRIVATE_KEY/);
    assert.match(deployCode, /SSH_PRIVATE_KEY: \$\{\{ secrets\.SSH_PRIVATE_KEY \}\}/);
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
