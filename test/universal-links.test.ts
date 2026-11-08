import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { appleAppSiteAssociation, IOS_APP_ID } from "@/lib/universal-links";

const ROOT = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("Universal Links（#619）", () => {
  it("appIDがXcodeプロジェクトのチームIDとBundle IDに一致する", () => {
    const pbx = read("ios/Morrow.xcodeproj/project.pbxproj");
    const team = pbx.match(/DEVELOPMENT_TEAM = (\w+);/)?.[1];
    const bundle = pbx.match(/PRODUCT_BUNDLE_IDENTIFIER = (com\.gucchii\.morrow);/)?.[1];
    assert.equal(IOS_APP_ID, `${team}.${bundle}`);
  });

  it("ルートを含み、ログイン・認証・APIは除外する（除外が先）", () => {
    const components = appleAppSiteAssociation().applinks.details[0].components;
    const idx = (p: string) => components.findIndex((c) => c["/"] === p);
    assert.ok(idx("/*") > idx("/api/*"));
    for (const p of ["/login", "/auth/*", "/api/*"]) {
      assert.equal((components[idx(p)] as { exclude?: boolean }).exclude, true, p);
    }
  });

  it("entitlementsにassociated-domainsがあり、middlewareの対象外になっている", () => {
    assert.match(read("ios/Morrow.entitlements"), /applinks:aide-bot\.gucchii\.com/);
    assert.match(read("src/proxy.ts"), /\.well-known\/apple-app-site-association/);
  });
});
