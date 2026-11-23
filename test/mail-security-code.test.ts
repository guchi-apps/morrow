import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extractSecurityCode } from "@/lib/mail/security-code";

describe("extractSecurityCode（#1135）", () => {
  const cases: [string, string, string, string | null][] = [
    ["日本語の認証コード", "ログイン確認", "認証コードは 482913 です。10分以内に入力してください。", "482913"],
    ["確認コード（件名側）", "【Amazon】確認コード: 7421", "", "7421"],
    ["英語", "Your code", "Your verification code is 123456. Do not share it.", "123456"],
    ["区切り付き", "OTP", "Your security code: 123-456", "123456"],
    ["空白区切り", "x", "ワンタイムパスワード 123 456", "123456"],
    ["手掛かり語なしの数字は採らない", "ご案内", "郵便番号 5300001 の件でご連絡します 2026", null],
    ["金額・年は採らない", "確認コード", "ご利用金額 12000円 2026年11月", null],
    ["遠い数字は採らない", "認証", `認証コードのお知らせ${"あ".repeat(60)}123456`, null],
    ["桁数の範囲外", "認証コード", "認証コード 12", null],
  ];
  for (const [name, subject, snippet, expected] of cases) {
    it(name, () => assert.equal(extractSecurityCode(subject, snippet), expected));
  }
});
