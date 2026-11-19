/**
 * 添付の応答の `Content-Disposition`（#1101。純粋。`test/mail-attachment-check.test.ts`）。
 *
 * ファイル名はメール由来の外から来る値なので、ヘッダーを壊す文字（改行・`"`・`\`・`;`）と、
 * パスの区切り・制御文字・向きを変える制御文字を落とす。日本語は `filename*`（RFC 5987）で渡し、
 * `filename` には安全なASCIIだけの代わりの名前を入れる。
 */
export function safeDownloadName(filename: string): string {
  const cleaned = filename
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩‎‏]/g, "")
    .replace(/[\\/:*?"<>|;]/g, "_")
    .replace(/^[\s.]+|[\s.]+$/g, "")
    .slice(0, 180);
  return cleaned || "attachment";
}

export function attachmentDisposition(type: "inline" | "attachment", filename: string): string {
  const name = safeDownloadName(filename);
  const ascii = name.replace(/[^\x20-\x7e]/g, "_");
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
