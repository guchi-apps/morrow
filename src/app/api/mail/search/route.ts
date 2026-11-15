import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { parseAccountFilter } from "@/lib/mail/account-filter";
import { isMailViewKey } from "@/lib/mail/contract";
import { subscribeMailSearch } from "@/lib/mail/search";
import { SEARCH_TEXT_LIMIT } from "@/lib/mail/search-core";

/**
 * メールのAI検索（#998）。画面（`/mail` の検索欄）が叩き、段階ごとの知らせ（`SearchEvent`）を1行1つのJSON（NDJSON）で流す。
 * 条件は一覧と同じ（`q` 必須・`view`・`acct`）。持ち主の照合は `listMailForPage()` → `listMail()` の中で行われる。
 * 画面が途中で離れても検索は最後まで走り、結果は10分だけ覚える（`search.ts`）。
 */

export const dynamic = "force-dynamic";
// 条件づくり（最大60秒）＋並べ替え（最大120秒）＋Codexの空き待ち
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const q = (params.get("q") ?? "").trim().slice(0, SEARCH_TEXT_LIMIT);
  if (!q) {
    return NextResponse.json({ error: "検索する語がありません。" }, { status: 400 });
  }
  const viewParam = params.get("view");
  const view = isMailViewKey(viewParam) ? viewParam : "inbox";
  const filter = parseAccountFilter(params.get("acct"));
  const account = filter.kind === "keys" ? filter.keys.join(",") : null;

  const encoder = new TextEncoder();
  let stop: () => void = () => undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        stop();
        try {
          controller.close();
        } catch {
          // すでに閉じている
        }
      };
      stop = subscribeMailSearch(user, { view, filter, account, q }, (event) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          close();
          return;
        }
        if (event.type === "done") close();
      });
      request.signal.addEventListener("abort", close);
    },
    cancel() {
      stop();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
