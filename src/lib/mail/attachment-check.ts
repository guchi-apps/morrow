/**
 * メールの添付ファイルの簡易な安全性チェック（#1101）。**純粋なモジュール**（DB・ネットワークに触れない。
 * クライアントからもファイル名の事前判定に使う）。`test/mail-attachment-check.test.ts` が固定する。
 *
 * **ウイルス対策ソフトの代わりではない。** 見るのは、ファイル名（実行形式・二重拡張子・右から左の制御文字）と、
 * 中身の構造（先頭の署名と拡張子の一致・PDFのスクリプト／起動動作／埋め込みファイル・ZIPの中身の名前と
 * パスワードの有無・Officeのマクロ）だけ。依存は足していない（#1101の計画で外部サービス・ClamAVは見送り）。
 *
 * 判定は3段階: `danger`（Morrowからは保存させない）・`caution`（理由を見せ、確認してから保存）・`safe`（問題は見つからなかった）。
 */

export type AttachmentVerdict = "safe" | "caution" | "danger";

/** 画面のアイコン・表示名の区分。 */
export type AttachmentCategory = "image" | "pdf" | "archive" | "office" | "executable" | "web" | "text" | "other";

export type AttachmentCheck = {
  verdict: AttachmentVerdict;
  /** 利用者に見せる理由（日本語・1項目1文）。`safe` なら空。 */
  reasons: string[];
  /** 中身から見た種類の表示名（「PDF」「JPEG画像」など）。中身を見ていなければ拡張子から。 */
  kindLabel: string;
  /** 画面の中で開いて見せてよいもの。中身の署名で決まり、`safe` のときだけ付く。 */
  preview: "image" | "pdf" | null;
};

const ORDER: Record<AttachmentVerdict, number> = { safe: 0, caution: 1, danger: 2 };

function worse(a: AttachmentVerdict, b: AttachmentVerdict): AttachmentVerdict {
  return ORDER[a] >= ORDER[b] ? a : b;
}

/** 開くとプログラムとして動く拡張子。 */
const EXECUTABLE_EXT = new Set([
  "exe", "com", "scr", "pif", "bat", "cmd", "msi", "msp", "msix", "msixbundle", "appx", "appxbundle", "vbs", "vbe",
  "js", "jse", "wsf", "wsh", "ws", "ps1", "psm1", "psd1", "hta", "cpl", "jar", "lnk", "reg", "inf", "scf", "dll", "sys",
  "apk", "xapk", "app", "pkg", "mpkg", "command", "gadget", "application", "xll", "chm", "iso", "img", "vhd", "vhdx",
  "dmg", "ipa", "deb", "rpm", "elf", "run", "bin", "url", "settingcontent-ms", "library-ms", "search-ms",
]);

/** マクロを含む前提のOffice形式。 */
const MACRO_OFFICE_EXT = new Set(["docm", "dotm", "xlsm", "xltm", "xlam", "xlsb", "pptm", "potm", "ppam", "ppsm", "sldm"]);
const OOXML_EXT = new Set(["docx", "dotx", "xlsx", "xltx", "pptx", "potx", "ppsx", ...MACRO_OFFICE_EXT]);
const LEGACY_OFFICE_EXT = new Set(["doc", "dot", "xls", "xlt", "xla", "ppt", "pot", "pps", "rtf"]);
const ARCHIVE_EXT = new Set(["zip", "rar", "7z", "gz", "tgz", "tar", "bz2", "xz", "cab", "lzh", "lha", "z", "arj", "ace", "zipx"]);
/** 開くとブラウザで動く内容を持てる形式（偽のログイン画面に使われる）。 */
const WEB_EXT = new Set(["html", "htm", "xhtml", "shtml", "mht", "mhtml", "svg", "svgz", "xml", "one", "onepkg"]);
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "jfif", "gif", "webp", "heic", "heif", "bmp", "tif", "tiff", "avif"]);
const TEXT_EXT = new Set(["txt", "csv", "tsv", "ics", "vcf", "json", "md", "log"]);
/** 拡張子を偽装するときに前に付けられやすい、見た目の拡張子。 */
const DECOY_EXT = new Set(["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "jpg", "jpeg", "png", "gif", "txt", "zip", "mp4", "mp3"]);

/** ファイル名の最後の拡張子（小文字。無ければ空）。 */
export function extensionOf(filename: string): string {
  const name = filename.trim().replace(/[\s.]+$/, "");
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

/** 拡張子から見た区分（中身を見る前のアイコン用）。 */
export function categoryOf(filename: string, mimeType = ""): AttachmentCategory {
  const ext = extensionOf(filename);
  const mime = mimeType.toLowerCase();
  if (EXECUTABLE_EXT.has(ext)) return "executable";
  if (ext === "pdf" || mime === "application/pdf") return "pdf";
  if (IMAGE_EXT.has(ext) || (mime.startsWith("image/") && mime !== "image/svg+xml")) return "image";
  if (ARCHIVE_EXT.has(ext)) return "archive";
  if (OOXML_EXT.has(ext) || LEGACY_OFFICE_EXT.has(ext)) return "office";
  if (WEB_EXT.has(ext) || mime === "text/html" || mime === "image/svg+xml") return "web";
  if (TEXT_EXT.has(ext) || mime.startsWith("text/")) return "text";
  return "other";
}

const CATEGORY_LABEL: Record<AttachmentCategory, string> = {
  image: "画像",
  pdf: "PDF",
  archive: "圧縮ファイル",
  office: "Office文書",
  executable: "実行ファイル",
  web: "Webページ・図",
  text: "テキスト",
  other: "ファイル",
};

type NameFinding = { verdict: AttachmentVerdict; reasons: string[] };

/**
 * ファイル名と申告された種類だけで分かる危険（中身を取りに行く前に画面へ出す）。
 * 中身の検査（`checkAttachmentContent()`）はこの結果も含めて判定し直す。
 */
export function checkAttachmentName(filename: string, mimeType = ""): NameFinding {
  const reasons: string[] = [];
  let verdict: AttachmentVerdict = "safe";
  const add = (v: AttachmentVerdict, reason: string) => {
    verdict = worse(verdict, v);
    if (!reasons.includes(reason)) reasons.push(reason);
  };

  // 右から左へ並べ替える制御文字（「cod.exe」を「exe.doc」に見せる）や、見えない文字
  if (/[‪-‮⁦-⁩‎‏]/.test(filename)) {
    add("danger", "ファイル名に、文字の並びを逆に見せる制御文字が入っています（拡張子の偽装によく使われます）。");
  }

  const ext = extensionOf(filename);
  const parts = filename.trim().toLowerCase().split(".");
  const previous = parts.length >= 3 ? parts[parts.length - 2]!.trim() : "";

  if (EXECUTABLE_EXT.has(ext)) {
    add("danger", `開くとプログラムとして動く形式（.${ext}）です。`);
    if (DECOY_EXT.has(previous)) add("danger", `拡張子が二重（.${previous}.${ext}）で、別の種類のファイルに見せかけています。`);
  } else if (DECOY_EXT.has(previous) && (ARCHIVE_EXT.has(ext) || WEB_EXT.has(ext))) {
    add("caution", `拡張子が二重（.${previous}.${ext}）です。見た目と実際の種類が違います。`);
  }
  if (/\s{4,}\.[a-z0-9]+$/i.test(filename)) add("caution", "拡張子の前に空白が続き、本当の拡張子を隠している可能性があります。");

  if (MACRO_OFFICE_EXT.has(ext)) add("caution", "マクロ付きのOffice文書です。マクロを有効にすると、プログラムが動きます。");
  if (WEB_EXT.has(ext) || mimeType.toLowerCase() === "text/html" || mimeType.toLowerCase() === "image/svg+xml") {
    add("caution", "開くとブラウザで動く内容を持てる形式です（偽のログイン画面に使われることがあります）。");
  }
  return { verdict, reasons };
}

type Sniffed = { kind: "pdf" | "png" | "jpeg" | "gif" | "webp" | "zip" | "ole" | "exe" | "elf" | "macho" | "rar" | "7z" | "gzip" | "html" | "unknown"; label: string };

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((b, i) => bytes[offset + i] === b);
}

/** 先頭の署名から中身の種類を見分ける。 */
export function sniff(bytes: Uint8Array): Sniffed {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { kind: "pdf", label: "PDF" };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: "png", label: "PNG画像" };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { kind: "jpeg", label: "JPEG画像" };
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return { kind: "gif", label: "GIF画像" };
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return { kind: "webp", label: "WebP画像" };
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) return { kind: "zip", label: "ZIP" };
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return { kind: "ole", label: "Office文書（旧形式）" };
  if (startsWith(bytes, [0x4d, 0x5a])) return { kind: "exe", label: "Windowsの実行ファイル" };
  if (startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46])) return { kind: "elf", label: "実行ファイル" };
  if ([[0xfe, 0xed, 0xfa, 0xce], [0xfe, 0xed, 0xfa, 0xcf], [0xce, 0xfa, 0xed, 0xfe], [0xcf, 0xfa, 0xed, 0xfe], [0xca, 0xfe, 0xba, 0xbe]].some((s) => startsWith(bytes, s))) {
    return { kind: "macho", label: "Macの実行ファイル" };
  }
  if (startsWith(bytes, [0x52, 0x61, 0x72, 0x21])) return { kind: "rar", label: "RAR" };
  if (startsWith(bytes, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return { kind: "7z", label: "7z" };
  if (startsWith(bytes, [0x1f, 0x8b])) return { kind: "gzip", label: "gzip" };
  const head = latin1(bytes.subarray(0, 1024)).replace(/^﻿|^\xEF\xBB\xBF/, "").trimStart().toLowerCase();
  if (/^(<!doctype html|<html|<script|<svg|<\?xml[^>]*>\s*<svg)/.test(head)) return { kind: "html", label: "Webページ・図" };
  return { kind: "unknown", label: "" };
}

function latin1(bytes: Uint8Array): string {
  let out = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) out += String.fromCharCode(...bytes.subarray(i, i + step));
  return out;
}

/** 拡張子が名乗る種類と中身の署名が合うか（合わない組み合わせだけ偽を返す）。 */
function extensionMatches(ext: string, kind: Sniffed["kind"]): boolean {
  if (kind === "unknown") return !(["pdf", "png", "jpg", "jpeg", "jfif", "gif", "webp", "zip", ...OOXML_EXT].includes(ext));
  if (ext === "pdf") return kind === "pdf";
  if (ext === "png") return kind === "png";
  if (ext === "jpg" || ext === "jpeg" || ext === "jfif") return kind === "jpeg";
  if (ext === "gif") return kind === "gif";
  if (ext === "webp") return kind === "webp";
  if (ext === "zip" || OOXML_EXT.has(ext)) return kind === "zip";
  return true;
}

type ZipEntry = { name: string; encrypted: boolean };

/** ZIPの中央ディレクトリから中身の名前と暗号化の印を読む（展開はしない）。読めなければ null。 */
export function readZipEntries(bytes: Uint8Array, limit = 5000): ZipEntry[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const min = Math.max(0, bytes.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= min; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count && n < limit; n++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) return entries.length > 0 ? entries : null;
    const flags = view.getUint16(offset + 8, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
    const name = (flags & 0x800) !== 0 ? new TextDecoder("utf-8", { fatal: false }).decode(nameBytes) : latin1(nameBytes);
    entries.push({ name, encrypted: (flags & 0x1) !== 0 });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** PDFの名前に使われる `#xx` の書き方（`/J#61vaScript`）を戻してから探す。 */
function pdfFindings(bytes: Uint8Array): NameFinding {
  const text = latin1(bytes).replace(/#([0-9a-fA-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  const reasons: string[] = [];
  let verdict: AttachmentVerdict = "safe";
  if (/\/Launch\b/.test(text)) {
    verdict = "danger";
    reasons.push("PDFに、開いたときに別のプログラムを起動する指示が入っています。");
  }
  if (/\/(JavaScript|JS)\b/.test(text)) {
    verdict = worse(verdict, "caution");
    reasons.push("PDFにスクリプト（JavaScript）が入っています。");
  }
  if (/\/EmbeddedFiles?\b/.test(text)) {
    verdict = worse(verdict, "caution");
    reasons.push("PDFの中に別のファイルが埋め込まれています。");
  }
  if (/\/(XFA|RichMedia)\b/.test(text)) {
    verdict = worse(verdict, "caution");
    reasons.push("PDFに動く部品（フォーム・動画など）が入っています。");
  }
  return { verdict, reasons };
}

function zipFindings(bytes: Uint8Array, ext: string): NameFinding {
  const entries = readZipEntries(bytes);
  if (!entries) return { verdict: "caution", reasons: ["圧縮ファイルの中身の一覧を読めませんでした（壊れているか、特殊な形式です）。"] };
  const reasons: string[] = [];
  let verdict: AttachmentVerdict = "safe";
  const names = entries.map((e) => e.name);
  const isOffice = OOXML_EXT.has(ext) || names.includes("[Content_Types].xml");
  if (isOffice) {
    if (names.some((n) => /vbaProject\.bin$/i.test(n))) {
      verdict = "caution";
      reasons.push("Office文書にマクロが入っています。マクロを有効にすると、プログラムが動きます。");
    }
    if (names.some((n) => /\/embeddings\/oleObject/i.test(n))) {
      verdict = worse(verdict, "caution");
      reasons.push("Office文書の中に別のファイルが埋め込まれています。");
    }
    if (entries.some((e) => e.encrypted)) {
      verdict = worse(verdict, "caution");
      reasons.push("中身を確かめられない形で保存されています。");
    }
    return { verdict, reasons };
  }
  if (entries.some((e) => e.encrypted)) {
    verdict = "caution";
    reasons.push("パスワード付きの圧縮ファイルで、中身を確かめられません（ウイルスを送るときによく使われる形です）。");
  }
  const dangerous = names.filter((n) => EXECUTABLE_EXT.has(extensionOf(n.split("/").pop() ?? "")));
  if (dangerous.length > 0) {
    verdict = "danger";
    reasons.push(`中に、開くとプログラムとして動くファイルが入っています（${dangerous.slice(0, 3).map((n) => n.split("/").pop()).join("、")}${dangerous.length > 3 ? " ほか" : ""}）。`);
  }
  const nested = names.filter((n) => ARCHIVE_EXT.has(extensionOf(n)));
  if (nested.length > 0) {
    verdict = worse(verdict, "caution");
    reasons.push("圧縮ファイルの中に、さらに圧縮ファイルが入っています（中身を確かめられません）。");
  }
  const macro = names.filter((n) => MACRO_OFFICE_EXT.has(extensionOf(n)) || WEB_EXT.has(extensionOf(n)));
  if (macro.length > 0) {
    verdict = worse(verdict, "caution");
    reasons.push("中に、マクロ付きの文書かWebページが入っています。");
  }
  return { verdict, reasons };
}

function oleFindings(bytes: Uint8Array): NameFinding {
  // ストレージ名はUTF-16LEで入る。「_VBA_PROJECT」「Macros」があればマクロ付き
  const text = latin1(bytes).replace(/\0/g, "");
  if (/_VBA_PROJECT/.test(text)) {
    return { verdict: "caution", reasons: ["Office文書にマクロが入っています。マクロを有効にすると、プログラムが動きます。"] };
  }
  return { verdict: "safe", reasons: [] };
}

/** 中身まで見た判定。ファイル名の判定（`checkAttachmentName()`）も含める。 */
export function checkAttachmentContent(filename: string, mimeType: string, bytes: Uint8Array): AttachmentCheck {
  const name = checkAttachmentName(filename, mimeType);
  let verdict = name.verdict;
  const reasons = [...name.reasons];
  const add = (finding: NameFinding) => {
    verdict = worse(verdict, finding.verdict);
    for (const r of finding.reasons) if (!reasons.includes(r)) reasons.push(r);
  };

  const ext = extensionOf(filename);
  const sniffed = sniff(bytes);

  if (sniffed.kind === "exe" || sniffed.kind === "elf" || sniffed.kind === "macho") {
    add({ verdict: "danger", reasons: ["中身が実行ファイル（プログラム）です。"] });
  }
  if (!extensionMatches(ext, sniffed.kind)) {
    add({ verdict: "caution", reasons: [`拡張子（${ext ? `.${ext}` : "なし"}）と中身の種類（${sniffed.label || "不明"}）が一致しません。`] });
  }
  if (sniffed.kind === "html" && !WEB_EXT.has(ext)) {
    add({ verdict: "caution", reasons: ["中身がWebページ・図です。開くとブラウザで動く内容を持てます。"] });
  }
  if (sniffed.kind === "pdf") add(pdfFindings(bytes));
  if (sniffed.kind === "zip") add(zipFindings(bytes, ext));
  if (sniffed.kind === "ole") add(oleFindings(bytes));
  if (sniffed.kind === "rar" || sniffed.kind === "7z") {
    add({ verdict: "caution", reasons: ["中身を確かめられない圧縮形式です。"] });
  }

  const preview = verdict !== "safe" ? null : sniffed.kind === "pdf" ? "pdf" : ["png", "jpeg", "gif", "webp"].includes(sniffed.kind) ? "image" : null;
  return { verdict, reasons: verdict === "safe" ? [] : reasons, kindLabel: sniffed.label || CATEGORY_LABEL[categoryOf(filename, mimeType)], preview };
}

/** 中身を見られなかったとき（大きすぎる等）の判定。ファイル名で危険なら危険のまま。 */
export function uncheckedAttachment(filename: string, mimeType: string, reason: string): AttachmentCheck {
  const name = checkAttachmentName(filename, mimeType);
  return {
    verdict: worse(name.verdict, "caution"),
    reasons: [...name.reasons, reason],
    kindLabel: CATEGORY_LABEL[categoryOf(filename, mimeType)],
    preview: null,
  };
}

/** 画面に開いて見せてよい種類の `Content-Type`（中身の署名で決めた値。申告の種類は信じない）。 */
export function previewContentType(bytes: Uint8Array): string | null {
  switch (sniff(bytes).kind) {
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    default:
      return null;
  }
}

export function categoryLabel(category: AttachmentCategory): string {
  return CATEGORY_LABEL[category];
}
