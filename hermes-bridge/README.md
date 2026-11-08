# morrow-hermes-bridge（#737）

subpcの127.0.0.1で動く、Hermes Agentへの中継。設計は `docs/hermes-route.md`、操作の範囲は `docs/hermes-actions.md`。
`tailscale serve` の裏に置き、Hermesの `/api/ws` のうち**ターンの開始・承認の回答・中断だけ**を通す。履歴（#752）はHermesのREST（`GET /api/sessions/{id}`・`/messages`。認証はヘッダー `X-Hermes-Session-Token` に同じトークン）を読むだけで、`source` が `morrow` のセッションに限る。Hermesの行には `api_content`・暗号化された推論・道具の引数と結果が載る（実物で確認）ので、`history.ts` が許可リストで絞る。依存は足していない（Node標準の `http`・`WebSocket`）。

```bash
pnpm hermes-bridge   # node hermes-bridge/server.ts
```

| 環境変数 | 内容 |
|---|---|
| `MORROW_HERMES_BRIDGE_PORT` | 待受ポート（127.0.0.1にだけバインド） |
| `HERMES_URL` | Hermesの宛先（例 `http://127.0.0.1:<ポート>`）。WebSocket（`/api/ws`）とREST（履歴の `/api/sessions`）の両方に使う |
| `HERMES_DASHBOARD_SESSION_TOKEN` | Hermesのトークン（subpcの外へ出さない） |
| `MORROW_HERMES_BRIDGE_TOKEN` | Morrowが送るBearer。**未設定なら全部401** |
| `MORROW_HERMES_PROPOSE_MCP_PORT` | 任意。提案用の何もしないMCP（`morrow_propose_action`）の待受ポート（127.0.0.1の `/mcp`。外へ出さない）。Morrow専用profileの `mcp_servers` の接続先にする |
| `MORROW_HERMES_BRIDGE_ALLOWED_IPS` | 許可する送信元（`X-Forwarded-For`）をカンマ区切りで。**空なら全部403** |

API: `GET /health`・`POST /turns`（SSE）・`POST /turns/<id>/approval`（`once`・`deny` だけ）・`POST /turns/<id>/interrupt`・`GET /sessions/<id>/messages?limit=N`（#752。直近N件・既定50・上限100）。
1セッション1ターン（409）・全体2本（429）・1ターン10分・15秒ハートビート・切断で中断。

テストは `test/hermes-bridge.test.ts`（Hermesの代わりに偽の接続を差し込む）。**実物のHermesでの疎通は #738 の手作業**で確かめる。
`session.create` / `session.resume` の応答の項目名（`session_id`・`stored_session_id`）は実測前の想定で、疎通で違えば `turn.ts` の `openSession()` を直す。
