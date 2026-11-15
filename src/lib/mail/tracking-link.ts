/**
 * メールの提案（#972）の「発送状況を追跡する」。配送会社の追跡ページを番号入りで開くだけで、Morrowは何も登録・保存しない。
 * クライアントからもimportするので、依存を持たない純粋な関数だけを置く。
 *
 * 追跡URLは配送会社の公開ページで、仕様の保証は無い。変わったらここだけ直す。
 */

export const CARRIERS = ["yamato", "sagawa", "japanpost"] as const;
export type Carrier = (typeof CARRIERS)[number];

export const CARRIER_LABELS: Record<Carrier, string> = {
  yamato: "ヤマト運輸",
  sagawa: "佐川急便",
  japanpost: "日本郵便",
};

export type TrackingFields = {
  /** 配送会社。読み取れないときはnull（画面で選ぶ）。 */
  carrier: Carrier | null;
  /** 追跡番号（ハイフン・空白を除いたもの）。 */
  number: string;
};

export function isCarrier(value: unknown): value is Carrier {
  return (CARRIERS as readonly unknown[]).includes(value);
}

/** ハイフン・空白・全角を落として英数字だけにする（日本郵便の国際は `EJ123456789JP` の形）。 */
export function normalizeTrackingNumber(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .replace(/[\s\-‐ー−]/g, "")
    .toUpperCase()
    .slice(0, 30);
}

const JAPANPOST_INTL = /^[A-Z]{2}\d{9}[A-Z]{2}$/;

/** 番号が配送会社の形に合うか。合わなければ理由（画面に出す）、合えばnull。 */
export function trackingBlocker(carrier: Carrier | null, number: string): string | null {
  if (number === "") return "追跡番号がありません。";
  if (carrier === null) return "配送会社を選んでください。";
  if (carrier === "japanpost") {
    if (/^\d{11,13}$/.test(number) || JAPANPOST_INTL.test(number)) return null;
    return "桁数が合いません（11〜13桁の数字か、英字2桁＋数字9桁＋英字2桁）。本文と見比べて直してください。";
  }
  if (/^\d{12}$/.test(number)) return null;
  return "桁数が合いません（12桁の数字）。本文と見比べて直してください。";
}

/** 番号の形から会社を決められるときだけ返す（モデルが会社を読めなかった回の補助）。12桁は決められない。 */
export function guessCarrier(number: string): Carrier | null {
  if (JAPANPOST_INTL.test(number)) return "japanpost";
  if (/^\d{11}$/.test(number) || /^\d{13}$/.test(number)) return "japanpost";
  return null;
}

/** 追跡ページのURL。検証を通らない組み合わせはnull。 */
export function trackingUrl(carrier: Carrier | null, number: string): string | null {
  if (trackingBlocker(carrier, number) !== null || carrier === null) return null;
  const n = encodeURIComponent(number);
  switch (carrier) {
    case "yamato":
      // 番号入りの追跡フォームへ自動送信するページ（GETで開ける）
      return `https://jizen.kuronekoyamato.co.jp/jizen/servlet/crjz.b.NQ0010?id=${n}`;
    case "sagawa":
      return `https://k2k.sagawa-exp.co.jp/p/web/okurijosearch.do?okurijoNo=${n}`;
    case "japanpost":
      return `https://trackings.post.japanpost.jp/services/srv/search/direct?searchKind=S004&locale=ja&reqCodeNo1=${n}`;
  }
}
