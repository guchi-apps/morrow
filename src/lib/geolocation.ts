/**
 * 現在地を1回だけ取る（#1087）。追跡しない・保存しない。
 *
 * iOSアプリの殻では、殻が端末の位置情報（CoreLocation）から取った値を使う（`ios/Morrow/LocationProvider.swift` の
 * `morrowLocation` の口）。WKWebViewの `navigator.geolocation` はWebKitの確認を挟み、取れないことがあったため。
 * 殻の口が無い（ブラウザ・古い殻）・殻が答えなかったときは `navigator.geolocation` へ落とす。
 *
 * クライアント専用。サーバーからは呼ばない。
 */

export type LocateResult =
  | { status: "ok"; latitude: number; longitude: number }
  | { status: "denied" | "failed" | "unsupported" };

export type LocateOptions = {
  /** 諦めるまでの時間（ミリ秒） */
  timeoutMs?: number;
  /** 直前に取れた位置を使い回してよい古さ（ミリ秒。ブラウザの経路だけ。殻は5分） */
  maximumAgeMs?: number;
};

export const NATIVE_LOCATION_HANDLER = "morrowLocation";

type NativeHandler = { postMessage: (body: unknown) => Promise<unknown> };

/** 殻の口があれば返す。 */
function nativeHandler(): NativeHandler | null {
  if (typeof window === "undefined") return null;
  const handlers = (window as unknown as { webkit?: { messageHandlers?: Record<string, NativeHandler | undefined> } }).webkit
    ?.messageHandlers;
  const handler = handlers?.[NATIVE_LOCATION_HANDLER];
  return handler && typeof handler.postMessage === "function" ? handler : null;
}

/**
 * 殻の返事を読む。形の読めない値・範囲外の座標はnull（ブラウザの経路へ落とす）。
 * `denied` は殻がOSの許可で断られた結果なので、ブラウザの経路へ落とさずそのまま返す。
 */
export function readNativeLocation(value: unknown): LocateResult | null {
  if (!value || typeof value !== "object") return null;
  const reply = value as Record<string, unknown>;
  if (reply.status === "denied") return { status: "denied" };
  if (reply.status === "failed") return { status: "failed" };
  if (reply.status !== "ok") return null;
  const { latitude, longitude } = reply;
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { status: "ok", latitude, longitude };
}

function browserLocation({ timeoutMs, maximumAgeMs }: Required<LocateOptions>): Promise<LocateResult> {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) return Promise.resolve({ status: "unsupported" });
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ status: "ok", latitude: position.coords.latitude, longitude: position.coords.longitude }),
      (error) => resolve({ status: error.code === 1 ? "denied" : "failed" }),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: maximumAgeMs },
    );
  });
}

export async function locateOnce(options: LocateOptions = {}): Promise<LocateResult> {
  const settings = { timeoutMs: options.timeoutMs ?? 15_000, maximumAgeMs: options.maximumAgeMs ?? 5 * 60_000 };
  const handler = nativeHandler();
  if (handler) {
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const reply = await Promise.race([
        handler.postMessage({}),
        new Promise<"timeout">((resolve) => {
          timer = setTimeout(() => resolve("timeout"), settings.timeoutMs);
        }),
      ]).finally(() => clearTimeout(timer));
      // 殻が時間内に答えなければ失敗にする（ブラウザの経路でもう一度待たせない）
      if (reply === "timeout") return { status: "failed" };
      const result = readNativeLocation(reply);
      if (result) return result;
    } catch {
      // 殻が答えられなかった（古い殻の差異など）。ブラウザの経路で取り直す
    }
  }
  return browserLocation(settings);
}

export type LocatePermission = "granted" | "prompt" | "denied" | "unknown";

/**
 * 位置の許可の状態を、許可を求めずに調べる。許可済みのときだけ開いた時点で取る画面（雨雲レーダー）用。
 * 殻ではOSの許可（WKWebViewの `permissions` はOSの許可を映さないため）、ブラウザでは Permissions API。
 */
export async function locatePermission(): Promise<LocatePermission> {
  const handler = nativeHandler();
  if (handler) {
    try {
      const reply = (await handler.postMessage({ query: "permission" })) as { permission?: unknown } | null;
      const value = reply?.permission;
      if (value === "granted" || value === "prompt" || value === "denied") return value;
    } catch {
      // 古い殻など。Permissions APIで調べる
    }
  }
  try {
    const status = await navigator.permissions?.query({ name: "geolocation" });
    return status?.state ?? "unknown";
  } catch {
    return "unknown";
  }
}
