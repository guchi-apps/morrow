import { NextResponse, after } from "next/server";

import { hasValidBearer } from "@/lib/bearer-auth";
import { pruneListSummaries } from "@/lib/mail/list-summary";
import { runMailChecks } from "@/lib/mail/triage";

/**
 * 必要なメールのお知らせ（#683）の新着確認だけを起動する、メール専用のcron口（#768）。
 * vpsの `cron/crontab.txt` から2〜3分ごとに叩く（`/api/briefing` は15分ごとのまま。他の処理を巻き込まない）。
 *
 * 認証は `/api/briefing` と同じ `BRIEFING_TRIGGER_TOKEN` のBearer。**未設定なら経路ごと401**。
 * 同時実行は `runMailChecks()` の利用者ごとの `running` で1本に絞られるので、`/api/briefing` からの
 * 確認や画面の「いま確認」と重なっても二重判定にはならない（重なった回は `busy` で戻る）。
 * 新着が無い回はCodexを呼ばない。1分より短い間隔にしないこと（追加IMAPアカウントのログイン回数のため）。
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!hasValidBearer(request.headers.get("authorization"), process.env.BRIEFING_TRIGGER_TOKEN)) {
    return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });
  }

  after(async () => {
    try {
      for (const { userId, result } of await runMailChecks()) {
        if (result.status === "checked" && result.judged === 0 && !result.partial) continue;
        console.info(
          `[aide-bot] メールの確認: ${userId} ${result.status}（判定${result.judged}・必要${result.needed}・${result.delivered}台）` +
            `${result.partial ? " 一部のアカウントを取得できず" : ""}${result.failure ? ` ${result.failure}` : ""}`,
        );
      }
    } catch (error) {
      console.error("[aide-bot] メールの確認に失敗した", error);
    }
    // 30日を過ぎた一覧の要約を掃除する（#851）
    await pruneListSummaries().catch((error: unknown) => console.error("[aide-bot] 一覧の要約の掃除に失敗した", error));
  });

  return NextResponse.json({ ran: true });
}
