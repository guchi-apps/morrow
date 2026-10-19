#!/usr/bin/env bash
# 本番へ配る前に、issue-deckの共有トークンAPIから受け口の認証値を読めることを確かめる（#581）。
#
# NOTICE_INGEST_TOKEN・OPS_API_TOKEN は #570 から環境変数で配らず、共有トークン
# （AIDE_BOT_NOTICE_INGEST_TOKEN・OPS_API_TOKEN）を実行時に読むだけになった。issue-deckへ未登録のまま
# 配ると、フォールバックが無いので POST /api/notices・/api/mcp のお知らせ登録・GET /api/ai-usage が
# 401 で閉じる（画面からは見えない）。**読めなければ、何も送る前に落とす。**
#
# 必要な環境変数: SHARED_TOKEN_API_SECRET・ISSUE_DECK_URL（`src/lib/shared-token.ts` と同じ）。
# 値・Bearerは出力しない（HTTPステータスだけを見る）。読み取りは利用元 `aide-bot` として記録される。
set -euo pipefail

: "${SHARED_TOKEN_API_SECRET:=}" "${ISSUE_DECK_URL:=}"
NAMES=(AIDE_BOT_NOTICE_INGEST_TOKEN OPS_API_TOKEN)

if [[ -z "$SHARED_TOKEN_API_SECRET" || -z "$ISSUE_DECK_URL" ]]; then
  echo "::error::SHARED_TOKEN_API_SECRET と ISSUE_DECK_URL（organization変数 APP_BASE_URL）が空です。共有トークンを読めないため配布を止めます" >&2
  exit 1
fi

failed=0
for name in "${NAMES[@]}"; do
  status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 --retry 2 --retry-delay 2 \
    -H "Authorization: Bearer ${SHARED_TOKEN_API_SECRET}" \
    -H "x-shared-token-consumer: aide-bot" \
    -H "accept: application/json" \
    "${ISSUE_DECK_URL%/}/api/shared-tokens?name=${name}" || echo "000")"
  case "$status" in
    200) echo "共有トークン ${name}: 読めました" ;;
    404) echo "::error::共有トークン ${name} がissue-deckに未登録です（404）。issue-deckの設定画面で登録し、利用元に aide-bot が出ることを確かめてから配ってください（#570）" >&2; failed=1 ;;
    401|403|503) echo "::error::共有トークン ${name} を読めません（HTTP ${status}）。SHARED_TOKEN_API_SECRET がissue-deckの値と一致しているか確かめてください" >&2; failed=1 ;;
    *) echo "::error::共有トークン ${name} を取得できません（HTTP ${status}）。issue-deckに届かないか、応答が不正です" >&2; failed=1 ;;
  esac
done

exit "$failed"
