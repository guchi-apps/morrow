import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  inferMailAccounts,
  isMailAccountKey,
  isMailOwner,
  mailAccountKeyOf,
  mailAccountTone,
  mailSrcdoc,
  parseMailActionResponse,
  parseMailFailure,
  parseMailListResponse,
  parseMailMessageResponse,
  senderName,
  spansMailAccounts,
} from "@/lib/mail/contract";

/**
 * AIDEのメールAPIの契約（#683）。持ち主の照合と、`partial`（一部のアカウントが読めない）を
 * 「メールが無い」と読ませないことを固定する。
 */

const summary = {
  id: "abc123",
  threadId: "t1",
  from: '"市役所 税務課" <zeimu@example.jp>',
  subject: "納付期限",
  snippet: "第3期の…",
  receivedAt: 1_700_000_000_000,
  labelIds: ["INBOX", "UNREAD"],
  unread: true,
  starred: false,
};

describe("isMailOwner", () => {
  it("大文字小文字と空白を均して一致を見る", () => {
    assert.equal(isMailOwner("owner@example.com", " Owner@Example.com "), true);
  });
  it("違う人・空の値は本人扱いしない", () => {
    assert.equal(isMailOwner("owner@example.com", "other@example.com"), false);
    assert.equal(isMailOwner("", ""), false);
    assert.equal(isMailOwner("owner@example.com", null), false);
    assert.equal(isMailOwner(null, "owner@example.com"), false);
  });
});

describe("parseMailListResponse", () => {
  it("一覧を読み、壊れた行だけ落とす", () => {
    const page = parseMailListResponse({
      ok: true,
      owner: "owner@example.com",
      supportsLabels: true,
      partial: false,
      failedAccounts: [],
      labels: [{ id: "Label_1", name: "家族", type: "user" }, { id: "bad id", name: "x" }],
      messages: [summary, { id: "../evil" }, "x"],
      nextPageToken: "tok_1",
      resultSizeEstimate: 12,
    });
    assert.ok(page);
    assert.equal(page.messages.length, 1);
    assert.equal(page.labels.length, 1);
    assert.equal(page.nextPageToken, "tok_1");
    assert.equal(page.partial, false);
  });

  it("failedAccounts が載っていれば partial が立っていなくても欠落ありとする", () => {
    const page = parseMailListResponse({ ok: true, owner: "o@e.com", messages: [], failedAccounts: ["仕事用"] });
    assert.equal(page?.partial, true);
    assert.deepEqual(page?.failedAccounts, ["仕事用"]);
  });

  it("owner の無い応答・失敗の応答は読めないとする", () => {
    assert.equal(parseMailListResponse({ ok: true, messages: [] }), null);
    assert.equal(parseMailListResponse({ ok: false, error: "failed" }), null);
    assert.equal(parseMailListResponse(null), null);
  });
});

describe("parseMailMessageResponse / parseMailActionResponse", () => {
  it("本文を読む", () => {
    const result = parseMailMessageResponse({
      ok: true,
      owner: "o@e.com",
      supportsLabels: false,
      message: { ...summary, to: "o@e.com", cc: "", html: "<p>x</p>", text: null, attachments: [{ filename: "a.pdf", mimeType: "application/pdf", size: 10 }] },
    });
    assert.equal(result?.message.html, "<p>x</p>");
    assert.equal(result?.message.attachments[0]?.filename, "a.pdf");
  });
  it("操作の応答の owner を読む（事後照合に使う）", () => {
    assert.deepEqual(parseMailActionResponse({ ok: true, owner: "o@e.com", action: "archive", count: 2 }), { owner: "o@e.com", count: 2 });
    assert.equal(parseMailActionResponse({ ok: true, action: "archive" }), null);
  });
});

describe("parseMailFailure", () => {
  it("AIDEの拒否の理由を残す（複数アカウントにまたがる等）", () => {
    assert.deepEqual(parseMailFailure({ ok: false, error: "invalid_request", message: "またがる" }, 400), {
      kind: "invalid_request",
      message: "またがる",
    });
  });
  it("読めない応答はHTTPステータスから寄せる", () => {
    assert.equal(parseMailFailure(null, 503).kind, "unconfigured");
    assert.equal(parseMailFailure(null, 500).kind, "failed");
  });
});

describe("mailSrcdoc", () => {
  it("既定では外部画像を止め、表示を選んだときだけ https: を許す", () => {
    assert.match(mailSrcdoc("<p>x</p>", false), /img-src data:;/);
    assert.match(mailSrcdoc("<p>x</p>", true), /img-src data: https:;/);
    assert.match(mailSrcdoc("", false), /default-src 'none'/);
  });
});

describe("senderName", () => {
  it("表示名を取り出す", () => {
    assert.equal(senderName('"市役所 税務課" <zeimu@example.jp>'), "市役所 税務課");
    assert.equal(senderName("a@example.com"), "a@example.com");
  });
});

/** 複数アカウント（#711）。IDは `<鍵>~<元のID>`、メインも `main~` が付く。 */
describe("メールのアカウント", () => {
  it("IDとラベルIDの接頭辞から鍵を取る（メインも）", () => {
    assert.equal(mailAccountKeyOf("main~abc"), "main");
    assert.equal(mailAccountKeyOf("sub~Label_1"), "sub");
    assert.equal(mailAccountKeyOf("formal~INBOX.1.20"), "formal");
  });

  it("接頭辞が無い（単一アカウント）・鍵の形でない値は null", () => {
    assert.equal(mailAccountKeyOf("abc123"), null);
    assert.equal(mailAccountKeyOf("~abc"), null);
    assert.equal(mailAccountKeyOf("Sub~abc"), null);
    assert.equal(mailAccountKeyOf("thirteenchars1~abc"), null);
  });

  it("acct に渡せる鍵の形（main を含む）", () => {
    assert.equal(isMailAccountKey("main"), true);
    assert.equal(isMailAccountKey("sub1"), true);
    assert.equal(isMailAccountKey("Sub"), false);
    assert.equal(isMailAccountKey("a~b"), false);
    assert.equal(isMailAccountKey(""), false);
    assert.equal(isMailAccountKey(null), false);
  });

  it("鍵違いの組み合わせはまたがりとして検出する（行・ラベル共通）", () => {
    assert.equal(spansMailAccounts(["sub~1", "sub~2"]), false);
    assert.equal(spansMailAccounts(["sub~1", "main~2"]), true);
    assert.equal(spansMailAccounts(["sub~1", "formal~Label_1"]), true);
    assert.equal(spansMailAccounts(["abc", "def"]), false);
  });

  it("色は鍵だけで決まり、main＝オレンジ・sub＝灰・formal＝青で固定・同じ鍵は常に同じ", () => {
    assert.equal(mailAccountTone("main"), "rose");
    assert.equal(mailAccountTone("sub"), "gray");
    assert.equal(mailAccountTone("formal"), "blue");
    assert.equal(mailAccountTone("other"), mailAccountTone("other"));
  });

  it("行からアカウントを推定する（main を先頭、鍵順）。接頭辞の無い行は無視する", () => {
    const rows = [
      { id: "sub~1", account: "サブ" },
      { id: "formal~2", account: "フォーマル" },
      { id: "main~3", account: "メイン" },
      { id: "sub~4", account: "サブ" },
      { id: "plain", account: undefined },
    ];
    assert.deepEqual(inferMailAccounts(rows), [
      { key: "main", name: "メイン" },
      { key: "formal", name: "フォーマル" },
      { key: "sub", name: "サブ" },
    ]);
    assert.deepEqual(inferMailAccounts([{ id: "plain", account: undefined }]), []);
  });

  it("一覧の応答の accounts は任意で、形の悪い要素は落とす", () => {
    const base = { ok: true, owner: "o@e.com", messages: [] };
    assert.equal(parseMailListResponse(base)?.accounts, null);
    const page = parseMailListResponse({
      ...base,
      accounts: [{ key: "main", name: "メイン" }, { key: "Bad", name: "x" }, { key: "sub" }, "x"],
    });
    assert.deepEqual(page?.accounts, [{ key: "main", name: "メイン" }]);
  });
});
