"use client";

import { LocateFixed } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { hereHref } from "@/lib/weather/place-input";

/**
 * 天気ページを地点指定なしで開いたとき、現在地を1回取って `/weather?here=1&lat=&lon=` へ置き換える（#882）。
 * iOSアプリの殻はWKWebViewの位置情報を許可済み（#641）なので、`navigator.geolocation` がそのまま使える。
 * 常時追跡はしない。位置はサーバーに保存せず、小数2桁に丸めてURLへ載せる。拒否・失敗では再要求せず案内だけ出す。
 */

type State = "locating" | "denied" | "failed" | "unsupported";

const MESSAGES: Record<Exclude<State, "locating">, string> = {
  denied: "位置情報が許可されていないため、現在地の天気は出せません。許可すると、開いたときに現在地の天気が出ます（アプリは設定アプリの位置情報、ブラウザはサイトの設定）。下の一覧から地点を選べます。",
  failed: "現在地を取得できませんでした。下の一覧から地点を選ぶか、開き直してください。",
  unsupported: "この環境では現在地を取得できません。下の一覧から地点を選んでください。",
};

export function AutoLocate({ date }: { date?: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>("locating");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!("geolocation" in navigator)) {
      queueMicrotask(() => setState("unsupported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => router.replace(hereHref(position.coords, date)),
      (error) => setState(error.code === 1 ? "denied" : "failed"),
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 5 * 60_000 },
    );
  }, [router, date]);

  return (
    <p role="status" className="flex items-start gap-1.5 text-[0.8125rem] leading-relaxed text-muted">
      <LocateFixed className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      {state === "locating" ? "現在地を確認しています…" : MESSAGES[state]}
    </p>
  );
}
