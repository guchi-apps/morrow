# MorrowからHermes Agentへの経路と認証（#726）

本番のMorrow（VPS）から、subpc（ベアメタル・Tailscale）のHermes Agentへ指示を届ける経路と認証の設計。
前提は #725 の技術検証の結論（`hermes -p morrow serve --isolated` の WebSocket `/api/ws` を使う）。
チャット画面（#728）・操作の範囲と承認（#727）はこの経路の上に作る。

**状態: ブリッジ（`hermes-bridge/`）とMorrow側のクライアント（`src/lib/hermes/`）は #737、チャット画面は #794 で実装済み。** チャット画面（`/chat`）は #794 で実装済み。subpc側の設定・トークン登録・疎通確認は #738（手作業）。
DiscordのHermes（default profile）との境界・通知の重複は `docs/hermes-discord.md`（#729）。

## 結論

```
ブラウザ ──(Cookie/SSE)── Morrow（VPS・Next.js）
                              │  HTTPS（tailnet・WireGuard）＋ Bearer
                              ▼
            subpc: tailscale serve --https=<専用ポート>（tailnetのみ）
                              │  http://127.0.0.1:<ブリッジ>
                              ▼
            morrow-hermes-bridge（127.0.0.1。用途を絞った中継）
                              │  ws://127.0.0.1:<Hermes>/api/ws?token=<Hermesのトークン>
                              ▼
            hermes -p morrow serve --isolated（127.0.0.1）
```

- **経路はVPS→subpcの順向き。** VPS（tailnet上の `x162-43-74-7`）はすでにtailnetに参加している
- **Hermesもブリッジもループバックのまま。** 外へ出るのは `tailscale serve` の口だけで、tailnetの外からは届かない
- **認証は共有トークン（Bearer）＋送信元のtailnet IPの照合。** Hermes自身のトークンはsubpcから出さない
- ブラウザにはトークンもsubpcの名前も渡さない。中継はMorrowのサーバーが持つ（#725の結論と同じ）

## なぜHermesへ直接繋がないのか（実測）

### 1. tailscale serve越しだとHermesがHost違いで弾く

`tailscale serve` は**Hostヘッダーを書き換えずに渡す**。2026-11-08にsubpcで、ループバックの小さな
HTTPサーバー（受けたヘッダーを返すだけ）を `tailscale serve --https=8459` で出して確かめた（確認後に
`off` で消した）。

```
Host: subpc.<tailnet>.ts.net:8459
X-Forwarded-For: 100.81.154.79
X-Forwarded-Host: subpc.<tailnet>.ts.net:8459
X-Forwarded-Proto: https
Tailscale-User-Login: <tailnetの利用者>
```

Hermes（v0.22.5・`bf0203a794`）の `hermes_cli/web_server.py` の `host_header_middleware` は、
ループバックにバインドしたときHostがループバックの名前でなければ400を返す（DNS rebinding対策。
`web_server_boundary.py` の `_is_accepted_host()`）。通すには `dashboard.public_url` を設定するしか
ないが、非ループバックの `public_url` は**認証ゲート（パスワードかOAuth）を有効にし、固定トークンが
使えなくなる**（`public_hosts_engage_gate()`）。ループバック以外へのバインドも同じ（`should_require_auth()`。
`--insecure` は無効化済み）。

TCPのまま転送（`tailscale serve --tcp`）してVPS側がHost: 127.0.0.1を名乗れば通るが、Hermesの
DNS rebinding対策を外から騙す形になるので採らない。

### 2. Hermesのトークンは管理者権限

`serve` のトークンはダッシュボードと同じもので、会話だけでなく `tools.configure`（profileの道具の
設定を書き換える）・設定・セッションの削除まで使える。VPSへ置くと、Morrowが乗っ取られたとき
Hermesの権限設定（#727。`docs/hermes-actions.md`）ごと書き換えられる。**VPSに置くのは、ブリッジが許す操作だけを
呼べるトークン**にする。

## ブリッジ（morrow-hermes-bridge）

subpcで常駐する小さなHTTPサーバー。Hermesのメソッドのうち、チャットに要るものだけを通す。

| ブリッジのAPI | Hermesへ | 備考 |
|---|---|---|
| `GET /health` | 接続して `gateway.ready` を待つ | `{bridge:"ok", hermes:"ok"\|"down"}`。認証必須 |
| `POST /turns` `{sessionId?, text, title?}` | `session.create`（無ければ）/ `session.resume` → `prompt.submit` | 応答はSSE。`message.delta`・`tool.start`/`tool.complete`・`approval`・`clarify`・`message.complete`（`usage` 付き）をそのまま種類別に流す |
| `POST /turns/<id>/approval` `{requestId, choice}` | `approval` リクエストへの回答 | `once`・`deny` だけを通す（`always`・`session` は400。`docs/hermes-actions.md`） |
| `POST /turns/<id>/interrupt` | `session.interrupt` | |
| `GET /sessions/<id>/messages?limit=N` | REST `GET /api/sessions/{id}`（`source` の照合）→ `/api/sessions/{id}/messages?order=latest&inline_images=false` | #752。直近N件（既定50・上限100）。下の「会話の履歴」 |

- 接続ごとに `client.capabilities {server_requests:true}` を送る（送らないと承認が聞かれずに取り下げられる。#725）
- `session.create` の `source` は `morrow` に固定する（Hermes側の一覧で見分けるため）
- 取り消せない書き込みの提案用に、何もしないMCPの道具 `morrow_propose_action` をループバックで答える（Morrow専用profileの接続先。
  提案はMorrowがストリームの `tool.start` から読む。`docs/hermes-actions.md`）
- `tools.configure`・設定・削除・`dashboard` 系は**どの経路からも呼べない**
- Hermesのトークン（`HERMES_DASHBOARD_SESSION_TOKEN`）はsubpcの中だけ。起動時に乱数で作り、
  Hermesとブリッジの両方のunitへ同じ値を渡す（1Passwordには置かない。外へ出ないので正を持つ必要が無い）
- Node標準の `http`・`WebSocket`（Node 22以降）で足り、依存は増えない
- **置き場（#737で確定）**: コードはmorrowの `hermes-bridge/`（契約の型は `src/lib/hermes/contract.ts` を相対importで共有）、
  systemdのunit・`tailscale serve` の設定はsubpcリポジトリ（VOICEVOXと同じ扱い）。起動は `pnpm hermes-bridge`（`hermes-bridge/README.md`）
- **宛先 `HERMES_BRIDGE_URL`（#737で確定）**: GitHub変数 `vars.HERMES_BRIDGE_URL` を `deploy.yml` が `.env` へ渡す（tailnet名をGitに入れない）。未登録だと空になり、クライアントは `not_configured`

## 会話の履歴（#752）

画面を開き直したときに前のやり取りを見せるため、ブリッジが履歴を返す（`hermes-bridge/history.ts`）。Morrowは受け取って表示するだけで、**保存しない**（`docs/hermes-actions.md`「実行の記録」）。
**画面への表示は未実装**（チャット画面は #794 で作ったが、初版は開いている間のやり取りだけ。表示は別Issueで、Morrowの `hermesClient().history()` を呼ぶ）。

- **`source` が `morrow` のセッションだけ返す。** Discord（default profile）など他のセッションは、無いときと同じ404（`no_session`）で、中身も有無も見せない
- **WebSocketの `session.resume`＋`session.history` は使わない。** 読むだけでHermesに生きたセッションができる。RESTは読み取りだけで副作用が無い（同じ `X-Hermes-Session-Token`）
- **返すのは発言者（`user`／`assistant`）・本文・時刻と、Hermesの発言で呼んだ道具の名前だけ**（`HistoryMessage`。`src/lib/hermes/contract.ts`）。Hermesの行には `api_content`（モデルへ渡したシステム注記入りの本文）・暗号化された推論・道具の引数と結果が載る（2026-11-08に実物の `morrow` profileで確認）ので、許可リストで拾う。道具の結果の行（`role: tool`）・`display_kind` 付きの行（圧縮の要約など）は落とす
- **セッションidはHermesのURLのパスへ埋め込むので、`.` だけの値を断る**（`isPathSafeSessionId()`）。`..` を通すと `new URL()` がパスを畳み、`/api/sessions/../messages` がHermesの別のREST（`/api/messages`）を指す。ブリッジの入口（URLの解釈で畳まれる）と `history.ts`（Hermesへ送る直前）の両方で止まる
- 認証はヘッダー `X-Hermes-Session-Token`（WebSocketの `?token=` と同じ値）
- **確認カードの状態は入れない。** 正はMorrowのDB（`HermesProposal`）で、画面が突き合わせる
- 道具の結果の行を落とすので、Hermesからは表示件数の4倍＋1件を読む。読んだページが一杯・絞った結果が件数を超えたら `hasMore`（これより前があるかもしれない）
- 失敗は他の経路と同じ: 無い・Morrow以外は404 `no_session`、HermesのRESTに届かない・5xxは503 `hermes_down`。Morrow側は応答の形を `parseHistoryBody()` で確かめ、1件でも違えば `bad_response`

## 認証

### 比較

| 方式 | 採否 | 理由 |
|---|---|---|
| **共有トークン（Bearer）** | **採用** | issue-deckの共有トークン方式（`sharedTokenOrEnv()`）にそのまま載り、Morrowの他の外部呼び出し（`AIDE_MAIL_API_TOKEN` 等）と同じ扱いになる。経路はtailnet（WireGuard）とtailscale serveのTLSで二重に暗号化される |
| 短命トークン（HMAC署名＋時刻） | 不採用 | 盗聴・再送への備えだが、経路がtailnet内で盗聴の余地が小さい。署名鍵という共有秘密は結局要り、時刻ずれの扱いが増える |
| mTLS | 不採用 | tailnetがすでにノードの身元を保証している。証明書の発行・更新・配布の手間に見合わない |
| tailnetだけ（認証なし） | 不採用 | tailnetの全端末（iPhone・desktop・Mac）から叩けてしまう。端末1つの紛失がHermesの操作に直結する |

### 採用する形

- **トークン名 `MORROW_HERMES_BRIDGE_TOKEN`**（32バイトの乱数・hex）。正は1Password
  （`op://apps/morrow/hermes-bridge-token` を想定）
  - Morrow: issue-deckの共有トークンとして登録し、実行時に `sharedTokenOrEnv("MORROW_HERMES_BRIDGE_TOKEN", …)` で読む。
    `scripts/check-shared-tokens.sh` の `NAMES` へ足し、読めなければ配布を止める（#581と同じ）
  - subpc: ブリッジのunitの起動前に `op read` で読み、`~/.config/morrow-hermes-bridge/env`（0600。Gitに入れない）へ書く
- **ブリッジは定数時間比較で照合し、未設定なら全部401**（`/api/briefing` と同じ「未設定なら閉じる」）
- **送信元の照合**: `X-Forwarded-For`（tailscale serveが付ける送信元のtailnet IP）がVPSのtailnet IPと一致するときだけ通す
  （`MORROW_HERMES_BRIDGE_ALLOWED_IPS`）。tailscale serve以外からはループバックでしか届かないので、
  この見出しを偽装できるのはsubpc上のプロセスだけ
- 宛先のURL（`https://subpc.<tailnet>.ts.net:<ポート>`）はMorrowの環境変数 `HERMES_BRIDGE_URL`（シークレットではない。
  tailnet名をGitに入れないため、deploy.ymlの平文ではなくGitHub変数かマニフェストで渡す——実装Issueで決める）

## subpcが落ちている・寝ているときの見え方

「取得できなかった」と「無い」を混ぜない（#214）。Morrowのクライアントは次の4つを区別して画面へ渡す。

| 状態 | 判定 | 画面 |
|---|---|---|
| 届かない | 接続失敗・5秒のタイムアウト・tailscale serveの502（ブリッジ停止） | 「Hermesに届きません（サブPCが止まっている可能性）」。再試行ボタン |
| Hermesが落ちている | ブリッジが503（Hermesへ繋がらない） | 「Hermesが応答しません」 |
| 拒否 | 401/403 | 設定の不一致として扱い、ログに残す（利用者には「接続の設定に問題があります」） |
| 応答あり・会話が無い | 200で空 | ふつうの空表示 |

- **送れなかった指示は捨てずに入力欄へ戻す。溜めて後で送ることはしない**（復帰後に古い指示が勝手に動くのを避ける）
- 状態は `GET /health` を30秒キャッシュして画面に出す（開くたびに叩かない）
- subpcは常時稼働のサーバーで寝る運用ではないが、再起動・Tailscaleの切断はありうる

## タイムアウト・同時実行・レート制限

| 項目 | 値 | 置き場 |
|---|---|---|
| 接続（Morrow→ブリッジ） | 5秒 | Morrow |
| 1ターン全体 | 10分（承認待ちの上限 `approvals.timeout`＝300秒を含む） | ブリッジ（超えたら `session.interrupt`） |
| SSEのハートビート | 15秒ごとのコメント行 | ブリッジ→Morrow→ブラウザ（Apacheのプロキシで切られないように） |
| 同時実行 | 1セッション1ターン（2本目は409）、ブリッジ全体で2本 | ブリッジ |
| ターンの開始 | 利用者ごとに3秒に1回 | Morrow |
| 切断 | Morrowとの接続が切れたら `session.interrupt`（承認待ちは拒否で終わる） | ブリッジ |

- 切断時に続けて走らせ、`session.events.since` で追いかける形は #725 で未試験。まずは中断（安全側）で始め、要るなら後で広げる
- 使用量は `message.complete.usage` から `ApiUsage` へ1ターン1行（対応表は #725 のコメント）

## 必要な作業

### 実装（#737。済み）

1. ブリッジ（上のAPI・認証・制限）とテスト
2. Morrowのクライアント（`src/lib/hermes/`。`sharedTokenOrEnv()`・状態の区別・SSEの中継）
3. `scripts/check-shared-tokens.sh` の `NAMES` と `test/check-shared-tokens.test.ts` に `MORROW_HERMES_BRIDGE_TOKEN` を足す
   （未登録のまま配ると実行時に初めて失敗するため。#581と同じ扱い）。デプロイ後、issue-deckの利用元に `aide-bot` が出ることを確かめる

### 手作業（#738・71.manual-step）

1. **VPSからsubpcへ届くかの確認**（未確認。設計時にVPS上での実行ができなかった）:
   VPSで `tailscale status` にsubpcが出ること、`curl -sS https://subpc.<tailnet>.ts.net:8443/version`（既存のVOICEVOX）が返ることを確かめる
2. トークンの発行と登録: 1Passwordへ `hermes-bridge-token` を作り、issue-deckの共有トークン `MORROW_HERMES_BRIDGE_TOKEN` に登録（利用元 `aide-bot`）
3. subpc: Morrow専用profile（`hermes profile create morrow --clone`）、Hermesとブリッジのuser unit（lingering済み）、
   `tailscale serve --bg --https=<専用ポート> http://127.0.0.1:<ブリッジ>`（**443・8443には相乗りしない**。subpcのREADME「`tailscale serve` は443ではなく8443に出す」と同じ理由）
   **profileを作ったら `hermes -p morrow mcp login aide` も通す**（下の「AIDEのOAuthはprofileごと」）
4. VPSのtailnet IPをブリッジの許可リストへ（`tailscale ip -4` の値）
5. 任意の強化: TailscaleのACL（grants）で、subpcの専用ポートへ届く送信元をVPSだけに絞る（既存の通信を巻き込まないか確かめてから）

## AIDEのOAuthはprofileごと（#809）

Morrow専用profileの `mcp_servers.aide` は `auth: oauth`。**OAuthのトークンはprofileごとに持ち、`--clone` でも写らない**
（既定profile〔Discord〕の分は `~/.hermes/mcp-tokens/aide.*`、Morrow profileには無かった）。トークンが無いと、Hermesは起動はするが
AIDEの道具を1本も読み込まず、チャットは「接続中」のまま「予定表を確認できない」と答える（#809。天気はウェブ検索で代わりに答える）。

- **見分け方**: `~/.hermes/profiles/morrow/logs/agent.log` に
  `MCP OAuth setup failed for 'aide': ... no cached tokens found.`（続けて `hermes mcp login aide` を促す文）が5分ごとに出る。
  チャット画面では道具が「使える道具の検索」「ウェブ検索」だけになり、「予定の確認」が出ない
- **直し方（人の作業）**: subpcで `hermes -p morrow mcp login aide` を対話的に通し（AIDEの認可画面）、Hermesのuser unitを再起動する
- **既定profileのトークンファイルを写さない。** リフレッシュトークンを2つのprofileで使い回すと、片方が更新した時点でもう片方が失効しうる
- 接続状態（`/api/hermes/status`）はHermesに届くかだけを見ており、AIDEに繋がっているかは出ない
