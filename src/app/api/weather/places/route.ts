import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { readJsonObject } from "@/lib/json-body";
import { MAX_WEATHER_PLACES, parsePlaceInput } from "@/lib/weather/place-input";
import { addWeatherPlace, removeWeatherPlace } from "@/lib/weather/places-store";

/**
 * 天気ページ（#695）の登録地点の追加（POST）と削除（DELETE）。本文は `{ name, latitude, longitude }`
 * （削除は座標だけでよい）。座標は小数2桁に丸めて保存する。ログイン必須（`/api/*` はmiddlewareが素通しなので自分で見る）。
 */

export const dynamic = "force-dynamic";

async function readPlace(request: Request) {
  const body = await readJsonObject(request);
  if (!body) return null;
  return parsePlaceInput({ name: body.name ?? "地点", latitude: body.latitude, longitude: body.longitude });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const place = await readPlace(request);
  if (!place) return NextResponse.json({ error: "地点の名前と座標を送ってください。" }, { status: 400 });

  const result = await addWeatherPlace(user.id, place);
  if (!result.ok) {
    return NextResponse.json({ error: `登録できる地点は${MAX_WEATHER_PLACES}件までです。` }, { status: 409 });
  }
  return NextResponse.json({ ok: true, added: result.added });
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const place = await readPlace(request);
  if (!place) return NextResponse.json({ error: "地点の座標を送ってください。" }, { status: 400 });

  return NextResponse.json({ ok: true, removed: await removeWeatherPlace(user.id, place) });
}
