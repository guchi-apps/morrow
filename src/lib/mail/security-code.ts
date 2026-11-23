/**
 * 認証コード（ワンタイムコード）の取り出し（#1135。純粋。モデルは使わない）。
 *
 * 件名・冒頭（snippet）から、手掛かり語の近くにある4〜8桁の数字だけを採る。手掛かり語が無い数字
 * （郵便番号・金額・年など）は採らない。誤ったコードを出すより、取れないほうへ倒す。
 * 取り出したコードはDB・ログに残さない（通知の送信時に作るだけ）。
 */

const CLUE =
  /認証コード|確認コード|セキュリティコード|ワンタイム|本人確認コード|認証番号|確認番号|ログインコード|verification code|security code|confirmation code|login code|one[- ]time|passcode|\botp\b|\bcode\b/i;

/** 手掛かり語から数字までの最大距離（文字数）。 */
const WINDOW = 40;

/** 4〜8桁の数字。ハイフン・空白で区切られた「123 456」「123-456」も1つのコードとして読む。 */
const DIGITS = /(?<![\d]|\d[.,])(\d{3,4}[\s-]\d{3,4}|\d{4,8})(?!\d|[.,]\d|\s?(?:円|年|月|日|時|分|%|％))/g;

export function extractSecurityCode(subject: string, snippet: string): string | null {
  for (const text of [snippet, subject]) {
    const code = fromText(text);
    if (code) return code;
  }
  return null;
}

function fromText(text: string): string | null {
  if (!text) return null;
  const clue = new RegExp(CLUE.source, "gi");
  let best: { code: string; distance: number } | null = null;
  for (const match of text.matchAll(clue)) {
    const clueEnd = (match.index ?? 0) + match[0].length;
    const clueStart = match.index ?? 0;
    for (const found of text.matchAll(DIGITS)) {
      const start = found.index ?? 0;
      const end = start + found[0].length;
      // 手掛かり語の後ろ（優先）か直前の近くにある数字だけ
      const distance = start >= clueEnd ? start - clueEnd : clueStart >= end ? clueStart - end : 0;
      if (distance > WINDOW) continue;
      const code = found[0].replace(/[\s-]/g, "");
      if (code.length < 4 || code.length > 8) continue;
      const rank = start >= clueEnd ? distance : distance + WINDOW;
      if (!best || rank < best.distance) best = { code, distance: rank };
    }
  }
  return best?.code ?? null;
}
