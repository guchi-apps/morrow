import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { aideActionFailure, runAideAction } from "@/lib/hermes/aide-action";
import { hermesClient, rememberAideHealth } from "@/lib/hermes/client";
import { isHermesProfileOwner, PROFILE_OWNER_ONLY_MESSAGE } from "@/lib/hermes/profile-owner";
import { readJsonObject } from "@/lib/json-body";

/**
 * AIDEへの再ログイン（#1240）。
 * - `{ action: "start" }` → `{ flowId, authUrl }`（AIDEの認可画面のURL。画面が新しいタブで開く）
 * - `{ action: "complete", flowId, callbackUrl }` → `{ aide }`（ログイン後に移った先のURLを貼り付けたもの）
 * - `{ action: "cancel", flowId }` → `{ ok: true }`（Hermesが始める前のトークンへ戻す）
 *
 * **Hermesは始めた時点で今のトークンを消す**（失敗・取り消し・5分の時間切れで戻す）。画面はログインが切れているときだけ始めさせる。
 *
 * **認可URL・貼り付けたURLはDB・ログに残さない。** 検証はブリッジ（`parseAideCallbackUrl()`）とHermes（state）が行う。
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  // AIDEのトークンは共有profileに1つ。持ち主だけが入れ替えられる（#1188）
  if (!isHermesProfileOwner(user)) return NextResponse.json({ error: PROFILE_OWNER_ONLY_MESSAGE }, { status: 403 });

  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "指示の形が正しくありません。" }, { status: 400 });

  try {
    if (body.action === "start") {
      return NextResponse.json(await runAideAction(async () => (await hermesClient()).startAideLogin()));
    }
    if (body.action === "complete" && typeof body.flowId === "string" && typeof body.callbackUrl === "string") {
      const { flowId, callbackUrl } = body;
      const aide = await runAideAction(async () => (await hermesClient()).completeAideLogin(flowId, callbackUrl));
      rememberAideHealth(aide);
      return NextResponse.json({ aide });
    }
    if (body.action === "cancel" && typeof body.flowId === "string") {
      const { flowId } = body;
      // 取り消しは他の操作と重ねてよい（走っている完了待ちを止めるためにも使う）
      await (await hermesClient()).cancelAideLogin(flowId);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "指示の形が正しくありません。" }, { status: 400 });
  } catch (error) {
    return aideActionFailure(error);
  }
}
