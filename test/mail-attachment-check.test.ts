import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  categoryOf,
  checkAttachmentContent,
  checkAttachmentName,
  extensionOf,
  previewContentType,
  readZipEntries,
  uncheckedAttachment,
} from "@/lib/mail/attachment-check";
import { attachmentDisposition, safeDownloadName } from "@/lib/mail/attachment-response";

/**
 * 添付ファイルの簡易な安全性チェック（#1101）。判定がゆるむと危険なファイルを「問題なし」と出すので、
 * 実行形式・偽装・PDFのスクリプト・ZIPの中身・マクロの各経路を固定する。
 */

const enc = new TextEncoder();
const bytes = (...parts: (string | number[])[]) => {
  const chunks = parts.map((p) => (typeof p === "string" ? enc.encode(p) : Uint8Array.from(p)));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
};

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10];

/** 中央ディレクトリだけを持つ最小のZIP（中身のデータは持たない。判定は名前と暗号化の印だけを読む）。 */
function zip(entries: { name: string; encrypted?: boolean }[]): Uint8Array {
  const local = [0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0];
  const central: number[] = [];
  for (const e of entries) {
    const name = [...enc.encode(e.name)];
    const header = new Array(46).fill(0);
    header.splice(0, 4, 0x50, 0x4b, 0x01, 0x02);
    const flags = (e.encrypted ? 1 : 0) | 0x800;
    header[8] = flags & 0xff;
    header[9] = flags >> 8;
    header[28] = name.length & 0xff;
    header[29] = name.length >> 8;
    central.push(...header, ...name);
  }
  const eocd = new Array(22).fill(0);
  eocd.splice(0, 4, 0x50, 0x4b, 0x05, 0x06);
  eocd[10] = entries.length;
  eocd[12] = central.length & 0xff;
  eocd[13] = (central.length >> 8) & 0xff;
  eocd[16] = local.length;
  return Uint8Array.from([...local, ...central, ...eocd]);
}

describe("ファイル名だけの判定", () => {
  it("実行形式は危険", () => {
    assert.equal(checkAttachmentName("setup.exe").verdict, "danger");
    assert.equal(checkAttachmentName("run.JS").verdict, "danger");
    assert.equal(checkAttachmentName("ショートカット.lnk").verdict, "danger");
    assert.equal(checkAttachmentName("disk.iso").verdict, "danger");
  });
  it("二重拡張子は理由に出す", () => {
    const r = checkAttachmentName("請求書.pdf.exe");
    assert.equal(r.verdict, "danger");
    assert.ok(r.reasons.some((x) => x.includes(".pdf.exe")));
  });
  it("末尾の空白・ドットで拡張子を隠しても拾う", () => {
    assert.equal(extensionOf("a.exe. "), "exe");
    assert.equal(checkAttachmentName("a.exe. ").verdict, "danger");
  });
  it("向きを変える制御文字は危険", () => {
    assert.equal(checkAttachmentName("invoice‮fdp.exe").verdict, "danger");
    assert.equal(checkAttachmentName("photo‮gpj.zip").verdict, "danger");
  });
  it("マクロ付き・HTML・SVGは注意", () => {
    assert.equal(checkAttachmentName("表.xlsm").verdict, "caution");
    assert.equal(checkAttachmentName("login.html").verdict, "caution");
    assert.equal(checkAttachmentName("a.bin", "image/svg+xml").verdict, "danger"); // .bin は実行形式扱い
    assert.equal(checkAttachmentName("logo.svg").verdict, "caution");
  });
  it("普通の名前は問題なし", () => {
    assert.deepEqual(checkAttachmentName("会場マップ.pdf"), { verdict: "safe", reasons: [] });
    assert.equal(checkAttachmentName("photo.jpg").verdict, "safe");
    assert.equal(checkAttachmentName("資料.zip").verdict, "safe");
  });
  it("区分", () => {
    assert.equal(categoryOf("a.pdf"), "pdf");
    assert.equal(categoryOf("a.JPEG"), "image");
    assert.equal(categoryOf("x", "image/png"), "image");
    assert.equal(categoryOf("a.docx"), "office");
    assert.equal(categoryOf("a.exe"), "executable");
  });
});

describe("中身の判定", () => {
  it("中身が一致する画像・PDFは問題なしで、開ける", () => {
    const png = checkAttachmentContent("a.png", "image/png", bytes(PNG));
    assert.equal(png.verdict, "safe");
    assert.equal(png.preview, "image");
    const pdf = checkAttachmentContent("a.pdf", "application/pdf", bytes("%PDF-1.7\n1 0 obj << /Type /Catalog >>\n%%EOF"));
    assert.equal(pdf.verdict, "safe");
    assert.equal(pdf.preview, "pdf");
    assert.equal(pdf.kindLabel, "PDF");
  });
  it("拡張子と中身が違えば注意で、開かせない", () => {
    const r = checkAttachmentContent("photo.jpg", "image/jpeg", bytes(PNG));
    assert.equal(r.verdict, "caution");
    assert.equal(r.preview, null);
    assert.equal(checkAttachmentContent("a.pdf", "application/pdf", bytes("hello")).verdict, "caution");
  });
  it("中身が実行ファイルなら名前によらず危険", () => {
    assert.equal(checkAttachmentContent("photo.jpg", "image/jpeg", bytes([0x4d, 0x5a, 0x90, 0])).verdict, "danger");
    assert.equal(checkAttachmentContent("note.txt", "text/plain", bytes([0x7f, 0x45, 0x4c, 0x46])).verdict, "danger");
  });
  it("PDFのスクリプト・起動動作・埋め込みファイル", () => {
    assert.equal(checkAttachmentContent("a.pdf", "", bytes("%PDF-1.4 /OpenAction << /S /JavaScript /JS (app.alert(1)) >>")).verdict, "caution");
    assert.equal(checkAttachmentContent("a.pdf", "", bytes("%PDF-1.4 /J#61vaScript")).verdict, "caution");
    assert.equal(checkAttachmentContent("a.pdf", "", bytes("%PDF-1.4 << /S /Launch /F (cmd.exe) >>")).verdict, "danger");
    assert.equal(checkAttachmentContent("a.pdf", "", bytes("%PDF-1.4 /EmbeddedFiles")).verdict, "caution");
  });
  it("ZIPの中の実行形式は危険、パスワード付きは注意", () => {
    assert.equal(checkAttachmentContent("a.zip", "", zip([{ name: "docs/請求書.pdf.exe" }])).verdict, "danger");
    const locked = checkAttachmentContent("a.zip", "", zip([{ name: "a.pdf", encrypted: true }]));
    assert.equal(locked.verdict, "caution");
    assert.ok(locked.reasons[0]?.includes("パスワード"));
    assert.equal(checkAttachmentContent("a.zip", "", zip([{ name: "a.pdf" }, { name: "b.jpg" }])).verdict, "safe");
    assert.equal(checkAttachmentContent("a.zip", "", zip([{ name: "in.zip" }])).verdict, "caution");
  });
  it("ZIPの中身の一覧を読む", () => {
    assert.deepEqual(readZipEntries(zip([{ name: "x.txt" }, { name: "y.pdf", encrypted: true }])), [
      { name: "x.txt", encrypted: false },
      { name: "y.pdf", encrypted: true },
    ]);
    assert.equal(readZipEntries(bytes("PK\u0003\u0004 broken")), null);
  });
  it("Officeのマクロ（新形式・旧形式）", () => {
    assert.equal(checkAttachmentContent("a.docx", "", zip([{ name: "[Content_Types].xml" }, { name: "word/document.xml" }])).verdict, "safe");
    assert.equal(checkAttachmentContent("a.docx", "", zip([{ name: "[Content_Types].xml" }, { name: "word/vbaProject.bin" }])).verdict, "caution");
    const ole = bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], [..."_VBA_PROJECT"].flatMap((c) => [c.charCodeAt(0), 0]));
    assert.equal(checkAttachmentContent("a.doc", "", ole).verdict, "caution");
    assert.equal(checkAttachmentContent("a.doc", "", bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])).verdict, "safe");
  });
  it("拡張子の無いHTMLは注意", () => {
    assert.equal(checkAttachmentContent("readme.txt", "text/plain", bytes("<!DOCTYPE html><html>")).verdict, "caution");
  });
  it("中身を見られないときは少なくとも注意", () => {
    assert.equal(uncheckedAttachment("big.pdf", "", "大きすぎる").verdict, "caution");
    assert.equal(uncheckedAttachment("big.exe", "", "大きすぎる").verdict, "danger");
  });
  it("開くときの種類は中身の署名だけで決める", () => {
    assert.equal(previewContentType(bytes(JPEG)), "image/jpeg");
    assert.equal(previewContentType(bytes("<svg>")), null);
  });
});

describe("Content-Disposition", () => {
  it("ヘッダーを壊す文字・パスの区切りを落とし、日本語は filename* で渡す", () => {
    assert.equal(safeDownloadName('a"b\r\n/../c;.pdf'), "a_b_.._c_.pdf");
    assert.equal(safeDownloadName("..."), "attachment");
    const value = attachmentDisposition("attachment", "会場マップ.pdf");
    assert.match(value, /^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''%E4%BC%9A/);
    assert.ok(!/[\r\n]/.test(attachmentDisposition("inline", "x\r\nSet-Cookie: a=b")));
  });
});
