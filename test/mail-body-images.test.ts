import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { attachmentUrl, cidReferences, embeddedImages, externalImageUrls, listedAttachments, replaceCids } from "@/lib/mail/body-images";
import { isMailAttachmentId, parseMailAttachmentResponse, parseMailFailure, parseMailMessageResponse, type MailAttachment } from "@/lib/mail/contract";

/** メール本文の画像（#1101）と、AIDEの添付の契約（aide#867）。 */

const file = (over: Partial<MailAttachment>): MailAttachment => ({
  filename: "a.png",
  mimeType: "image/png",
  size: 10,
  attachmentId: "1.2",
  contentId: null,
  inline: false,
  ...over,
});

describe("埋め込み画像（cid）", () => {
  const html = `<img src="cid:Logo@x"><img src='cid:qr%40y'><a href="cid:none">`;
  it("参照を小文字・復号して拾う", () => {
    assert.deepEqual(cidReferences(html), ["logo@x", "qr@y", "none"]);
  });
  it("本文から参照されている、取り出せる部品だけを埋め込みとする", () => {
    const logo = file({ contentId: "logo@x", inline: true });
    const noId = file({ contentId: "qr@y", attachmentId: null });
    const other = file({ filename: "b.pdf", contentId: null });
    assert.deepEqual(embeddedImages(html, [logo, noId, other]), [logo]);
    assert.deepEqual(listedAttachments(html, [logo, noId, other]), [noId, other]);
    assert.deepEqual(listedAttachments(null, [logo]), [logo]);
  });
  it("cid: を data: に差し替え、対応の無いものは残す", () => {
    const out = replaceCids(html, new Map([["logo@x", "data:image/png;base64,AA=="]]));
    assert.ok(out.includes(`src="data:image/png;base64,AA=="`));
    assert.ok(out.includes("cid:qr%40y"));
  });
});

describe("外部画像", () => {
  it("https だけ・重複なし・1×1の計測用は除く", () => {
    const html = `<img src="https://e.com/a.png?x=1&amp;y=2"><img src=https://e.com/a.png?x=1&y=2><img width="1" height="1" src="https://t.com/p.gif"><img src="http://e.com/b.png"><img width="100" src="https://e.com/c.png">`;
    assert.deepEqual(externalImageUrls(html), ["https://e.com/a.png?x=1&y=2", "https://e.com/c.png"]);
  });
});

describe("添付の契約（aide#867）", () => {
  it("attachmentId・contentId・inline を読み、無い版は null", () => {
    const result = parseMailMessageResponse({
      ok: true,
      owner: "o@e.com",
      message: {
        id: "m1",
        attachments: [
          { filename: "a.pdf", mimeType: "application/pdf", size: 10, attachmentId: "1.2", contentId: "<logo@x>", inline: true },
          { filename: "b.pdf", mimeType: "application/pdf", size: 10 },
          { filename: "c.pdf", mimeType: "application/pdf", size: 10, attachmentId: "../x" },
        ],
      },
    });
    const [a, b, c] = result!.message.attachments;
    assert.deepEqual(a, { filename: "a.pdf", mimeType: "application/pdf", size: 10, attachmentId: "1.2", contentId: "logo@x", inline: true });
    assert.equal(b?.attachmentId, null);
    assert.equal(c?.attachmentId, null);
  });
  it("識別子の形", () => {
    assert.ok(isMailAttachmentId("1.2"));
    assert.ok(isMailAttachmentId("ANGjdJ_x-9"));
    assert.ok(!isMailAttachmentId(".."));
    assert.ok(!isMailAttachmentId("a/b"));
    assert.ok(!isMailAttachmentId("x".repeat(65)));
  });
  it("取り出しの応答（base64）を読む", () => {
    const value = parseMailAttachmentResponse({ ok: true, owner: "o@e.com", source: "gmail", filename: "a.txt", mimeType: "text/plain", size: 3, data: "YWJj" });
    assert.equal(value?.owner, "o@e.com");
    assert.deepEqual([...value!.data], [97, 98, 99]);
    assert.equal(parseMailAttachmentResponse({ ok: true, owner: "o@e.com", data: "@@@" }), null);
    assert.equal(parseMailAttachmentResponse({ ok: true, data: "YWJj" }), null);
  });
  it("413 too_large", () => {
    assert.equal(parseMailFailure({ ok: false, error: "too_large" }, 413).kind, "too_large");
    assert.equal(parseMailFailure(null, 413).kind, "too_large");
  });
  it("中継のURL", () => {
    assert.equal(attachmentUrl("acct~m/1", "1.2", "download", { confirm: "1" }), "/api/mail/attachments/acct~m%2F1/1.2?mode=download&confirm=1");
  });
});
