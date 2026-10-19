# Morrow（aide-bot）

**Morrow（モロー）** — NotionやAIDEなどを参照し、朝の見通し・お知らせ・話題を集めて選んで届け、プライベートを補佐するPWA（相談・音声対話はChatGPTで代替するため#574で廃止）。
利用者に見える名前は Morrow で、リポジトリ名は `guchi-apps/morrow`（#414）、URL・DB名・環境変数などの内部識別子は `aide-bot` のまま。

| 項目 | 値 |
|---|---|
| 本番URL | https://aide-bot.gucchii.com/ |
| 本番ポート | `3103`（PM2 プロセス名 `aide-bot`） |
| 配布先 | VPS の `/apps/aide-bot/` |
| データベース | `app_aide_bot`（MariaDB / Prisma） |
| 認証 | Supabase Auth（Google。許可したアカウントのみ） |

## 技術構成

Next.js 16（App Router）+ TypeScript + Tailwind CSS v4 / Prisma + MariaDB / Supabase Auth。
パッケージマネージャは pnpm。

## セットアップ

```bash
pnpm install
pnpm env:init                 # .env.local.example を .env.local へコピー
# .env.local を編集する（DATABASE_URL / NEXT_PUBLIC_SUPABASE_*）
pnpm db:setup                 # .env.local の DATABASE_URL から DB・ユーザーを作成
pnpm db:migrate:dev
pnpm dev                      # http://localhost:3000
```

- Supabase の Redirect URLs に、開発で使うオリジンの `/auth/callback`（例: `http://localhost:3000/auth/callback`）を
  登録しておく必要がある
- スマートフォン実機から確認する場合は `sslip.io` でホスト名化したURLを使い、そのURLも
  Redirect URLs に登録する（生のLAN IPではOAuthのリダイレクトが失敗する）
- `PORT` を `.env.local` に書くと開発サーバーのポートを変えられる（既定は3000）

## 開発用ログイン（Cookieバイパス）

全画面がSupabase Auth（Google OAuth）の背後にあり、GUIの無い環境（SSH越しの作業・CIの無人実行）
からは対話的な同意を完了できずログインできない。開発環境に限り、Supabaseを経由せず
ダミーユーザーとして入る導線を用意している。

```bash
pnpm db:seed:dev   # ダミーユーザーを投入し、CI_LOGIN_BYPASS_SECRET を .env.local へ生成する
pnpm dev           # 生成した値は再起動しないと効かない
```

ブラウザではログイン画面に出る「開発用ダミーユーザーでログイン」ボタンを押す。
コマンドだけで確認する場合は次のとおり。

```bash
curl -s -c /tmp/cookies.txt -o /dev/null -w '%{http_code} -> %{redirect_url}\n' \
  -X POST http://localhost:3000/api/dev/login    # 303 -> / なら成功
curl -s -b /tmp/cookies.txt -o /dev/null -w '%{http_code}\n' http://localhost:3000/   # 200
```

- **本番では二重に無効化している。** `NODE_ENV=production` では常に無効、
  `CI_LOGIN_BYPASS_SECRET` が未設定でも無効。片方だけ緩めないこと
- シークレットの実値はコミットしない（`.env.local` はgit管理外）
- ボタンが出ない・`/api/dev/login` が404を返すときは `CI_LOGIN_BYPASS_SECRET` が空。
  worktreeを新しく作った直後は `.env.local` が無いことがあるので `pnpm env:init` からやり直す

## よく使うコマンド

| コマンド | 内容 |
|---|---|
| `pnpm dev` | 開発サーバー |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | 型チェック |
| `pnpm build:ci` | CIと同じビルド |
| `pnpm db:migrate:dev` | マイグレーション作成・適用（開発） |
| `pnpm db:seed:dev` | 開発用ダミーデータの投入＋開発用ログインの有効化 |
| `pnpm db:studio` | Prisma Studio |

## 環境変数

| 変数 | 用途 |
|---|---|
| `DATABASE_URL` | MariaDB接続。本番は `DB_*` から `scripts/construct-database-url.sh` が組み立てる |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase Auth（他アプリと共有のプロジェクト） |
| `ALLOWED_GOOGLE_EMAILS` | **判定には使わない**（#513でStatusHubの共通アクセス設定へ切替済み。旧設定の整理待ちで残っている） |
| `ACCESS_API_URL` / `ACCESS_APP_TOKEN` | 判定APIの宛先（既定は本番StatusHub）と、共有トークンを読めない開発環境用のアプリ別トークン |
| `CODEX_BIN` | 返答生成に使う `codex` の実行ファイル。未設定なら PATH 上の `codex` |
| `NOTICE_INGEST_TOKEN` | ChatGPTのスケジュールなどから `/api/mcp`・`/api/notices` へ登録するときのBearerシークレット |
| `SIGNALY_WEBHOOK_URL` | CI／デプロイ結果の通知先 |
| `CI_LOGIN_BYPASS_SECRET` | 開発用ログイン（Cookieバイパス）のシークレット。**本番には設定しない** |

変数名の一覧は `.env.example`、ローカルの記入例は `.env.local.example`、
デプロイ時の取得元は `.github/secrets-manifest.tsv` を参照する。

## 画面

| パス | 内容 |
|---|---|
| `/` | 今日のダッシュボード（天気・予定・今日届いた通知・お知らせ・話題。通知を押した先） |
| `/notices` | 積まれたお知らせの一覧 |
| `/topics` | 仕入れた話題と、定時のお知らせの設定 |
| `/models` | 用途ごとのAIモデル |
| `/usage` | 使用量 |
| `/settings` | 通知・接続などの設定 |
| `/c/<ID>` | 古い通知の受け皿（`/` へリダイレクトするだけ） |
| `/login` | ログイン |

ChatGPTのスケジュールから情報を登録する方法は [docs/chatgpt-mcp.md](docs/chatgpt-mcp.md) を参照。

### 実機（iPhoneのPWA）で開発環境を見る

マイク機能は廃止したが、ホーム画面に追加したPWAはHTTPSでないと確かめられない。`pnpm dev:https`（`scripts/dev-https.sh`）が
Tailscale越しのHTTPSで開発サーバーを公開する。`next.config.mjs` の `allowedDevOrigins` に `**.ts.net` が入っている。
**443は他のアプリが使っているので、ポートを明示せずに `tailscale serve` を張らない**（詳細は [CLAUDE.md](CLAUDE.md)）。

## デプロイ

`main` へのpushで `.github/workflows/deploy.yml` が動く。GitHub Actions側でビルドし、
成果物をVPSの app-deploy-gate（guchi-apps/vps。アプリ名 `aide-bot`）へアプリ専用のSSH鍵で渡し、
展開・マイグレーション・PM2の再起動・稼働版の照合はgateが行う（#567。詳細は [CLAUDE.md](CLAUDE.md) の「デプロイ」）。
日常の開発は `develop`、本番反映は `develop` → `main` のPR。

## Issueごとのエージェント運用

`@claude` コメント起点の無人実行に対応している。運用ルールは [CLAUDE.md](CLAUDE.md) を参照。

## iOSアプリ（#441）

Web版をiPhoneの独立したアプリとして開くSwiftUI＋WKWebViewの殻を `ios/` で管理する。
画面・会話・履歴は既存のWeb版が正本。ビルド・TestFlight配布・初回の手作業は [ios/README.md](ios/README.md)。
