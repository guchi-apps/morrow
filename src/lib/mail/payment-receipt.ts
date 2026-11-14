/**
 * メールから家計簿へ取り込む（#781）ときの、画面とサーバーで共有する決まりごと。依存を持たない（クライアントからもimportする）。
 *
 * Morrowは品目の入力欄を持たず、読み取った値で**確認待ちのレシート**（Asset Managerの `review: true`。asset-manager#1216・aide#832）を作り、
 * Asset Managerのレシート編集画面（`/receipts/<id>`）を開く。品目・カテゴリ・メモ・確定はAsset Managerで行う。
 */

export const ASSET_MANAGER_ORIGIN = "https://asset.gucchii.com";

export type PaymentItem = { name: string; amount: number; quantity: number | null };

/** 購入日が本文に無く、メールの受信日で補ったときの注記（#903）。 */
export const RECEIVED_DATE_NOTE = "本文に購入日が無いため、メールの受信日を使います";

type PaymentLike = { place: string | null; name: string; date: string | null; items: readonly PaymentItem[] };

/**
 * 確認待ちのレシートを作れない理由。作れるならnull。
 * Asset Managerは `review: true` でも購入日と、名前の手掛かり（品名・支払先・品目のどれか）を必須にしている。
 */
export function paymentBlocker(fields: PaymentLike): string | null {
  if (!fields.date) return "本文から購入日を読み取れなかったため、レシートを作れません。Asset Managerで直接入力してください。";
  if (!fields.name && !fields.place && fields.items.length === 0) return "本文から支払先・品目を読み取れなかったため、レシートを作れません。Asset Managerで直接入力してください。";
  return null;
}

/** 品目の合計（円）。品目が無ければnull。 */
export function itemsTotal(items: readonly PaymentItem[]): number | null {
  return items.length === 0 ? null : items.reduce((sum, item) => sum + item.amount, 0);
}

/** Asset Managerのレシート編集画面のURL。idが正の整数でなければnull。 */
export function receiptUrl(receiptId: unknown): string | null {
  return typeof receiptId === "number" && Number.isSafeInteger(receiptId) && receiptId > 0 ? `${ASSET_MANAGER_ORIGIN}/receipts/${receiptId}` : null;
}
