import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { jstDayKey } from "@/lib/day-key";
import { readJsonObject } from "@/lib/json-body";
import { municipalityAt } from "@/lib/weather/geocode";
import { OPEN_METEO_ATTRIBUTION, forecastAt } from "@/lib/weather/open-meteo";
import {
  describeWeatherCode,
  isValidCoordinates,
  nextHours,
  roundCoordinate,
} from "@/lib/weather/rain-check";

/**
 * 現在地の天気（#586）。ダッシュボード右上の「現在地」バッジを押したときだけ呼ばれる。
 *
 * - **位置は保存しない・ログに出さない。** 小数2桁（≒1km）に丸めてから国土地理院とOpen-Meteoへ送る
 * - 利用者ごとに10秒に1回まで（押し続けても外部へ連打しない。プロセス内の記録。PM2で1プロセスという前提）
 * - 市町村名が引けなくても予報は返す（海上など）。予報が取れなければ502
 */

export const dynamic = "force-dynamic";

const MIN_INTERVAL_MS = 10_000;
const lastCalls = new Map<string, number>();

function jstHourKey(at: Date): string {
  const hour = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", hourCycle: "h23" }).format(at);
  return `${jstDayKey(at)}T${hour}:00`;
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  }

  const body = await readJsonObject(request);
  if (!body || !isValidCoordinates(body.latitude, body.longitude)) {
    return NextResponse.json({ error: "位置（緯度・経度）の指定が正しくありません。" }, { status: 400 });
  }

  const now = Date.now();
  const last = lastCalls.get(user.id);
  if (last !== undefined && now - last < MIN_INTERVAL_MS) {
    return NextResponse.json({ error: "少し待ってからもう一度押してください。" }, { status: 429 });
  }
  lastCalls.set(user.id, now);

  const point = { latitude: roundCoordinate(body.latitude), longitude: roundCoordinate(body.longitude as number) };

  const [forecast, place] = await Promise.allSettled([forecastAt(point), municipalityAt(point)]);
  if (forecast.status === "rejected") {
    console.error("[aide-bot] 現在地の予報を取得できなかった", forecast.reason);
    return NextResponse.json({ error: "天気を取得できませんでした。少し待ってもう一度押してください。" }, { status: 502 });
  }
  if (place.status === "rejected") console.error("[aide-bot] 現在地の市町村名を取得できなかった", place.reason);

  const at = new Date(now);
  const today = forecast.value.daily.find((day) => day.date === jstDayKey(at)) ?? null;

  return NextResponse.json({
    place: place.status === "fulfilled" ? place.value : null,
    today: today
      ? { summary: describeWeatherCode(today.code), max: today.max, min: today.min, pop: today.pop }
      : null,
    next: nextHours(forecast.value, jstHourKey(at)),
    attribution: OPEN_METEO_ATTRIBUTION,
  });
}
