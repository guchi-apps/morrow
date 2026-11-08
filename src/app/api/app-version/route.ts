import { NextResponse } from "next/server";

import { APP_VERSION } from "@/lib/app-version";

// CDN・ブラウザにキャッシュされると稼働中の版を取り違えるため、常に動的に返す。
export const dynamic = "force-dynamic";

/**
 * 稼働しているコミットのSHA（#567）。`deploy.yml` が `.env` へ書く `APP_COMMIT_SHA` を返す。
 *
 * デプロイのヘルスチェックはこの `sha` が今回のコミットと一致するまで成功にしない
 * （旧版がHTTP 200を返しているだけの状態を成功と見なさないため）。issue-deckの新方式リリースも
 * 同じ値で稼働版を照合する。未ログインで127.0.0.1から叩かれるため、middlewareの公開経路
 * （`src/lib/supabase/public-paths.ts`）に入れてある。ローカル開発など未設定なら null。
 */
export async function GET() {
  return NextResponse.json(
    { version: APP_VERSION, sha: process.env.APP_COMMIT_SHA || null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
