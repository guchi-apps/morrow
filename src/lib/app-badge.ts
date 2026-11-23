/**
 * アプリアイコンのバッジ（#1144）。クライアント専用。
 *
 * 口の優先順: iOSの殻（`ios/Morrow/BadgeProvider.swift` の `morrowBadge`。WKWebViewには Badging API が無い）
 * → `navigator.setAppBadge()`（ホーム画面のPWA・対応ブラウザ）→ 何もしない。名前を変えるときはSwiftと揃える（`test/app-badge.test.ts`）。
 */

export const NATIVE_BADGE_HANDLER = "morrowBadge";

/** 件数を口へ渡せる値（0以上の整数・上限9999）にする。 */
export function normalizeBadgeCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(Math.max(Math.trunc(value), 0), 9999);
}

type NativeHandler = { postMessage: (body: unknown) => unknown };

function nativeHandler(): NativeHandler | null {
  if (typeof window === "undefined") return null;
  const handlers = (window as unknown as { webkit?: { messageHandlers?: Record<string, NativeHandler | undefined> } }).webkit
    ?.messageHandlers;
  const handler = handlers?.[NATIVE_BADGE_HANDLER];
  return handler && typeof handler.postMessage === "function" ? handler : null;
}

/** バッジを件数にする（0で消す）。口が無い・失敗したときは黙って何もしない。 */
export async function setAppBadge(count: number): Promise<void> {
  const value = normalizeBadgeCount(count);
  if (value === null) return;
  try {
    const native = nativeHandler();
    if (native) {
      await native.postMessage({ count: value });
      return;
    }
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (value === 0) await nav.clearAppBadge?.();
    else await nav.setAppBadge?.(value);
  } catch {
    // バッジは補助表示。権限なし・非対応で本筋を止めない
  }
}
