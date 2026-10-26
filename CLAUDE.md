# aide-bot 固有ルール

このファイルは、このリポジトリで作業するすべてのエージェント（ローカルのClaude Code・GitHub Actions上の
無人実行の両方）が読む前提の運用ルールを置く。**GitHub Actions上の無人実行は、個人環境の
`~/.claude/CLAUDE.md` もスキルも読み込まない。** Actionsでも守らせたいルールはここに書く。

## アプリ概要

NotionやAIDE（`guchi-apps/aide`）などを参照し、チャットボットでプライベートを補佐するPWA。
**利用者に見える名前は Morrow（#340。旧「秘書アプリ」）。** URL・DB名・環境変数・Cookie名・PM2名は `aide-bot` のまま変えない（リポジトリ名は #414 で `guchi-apps/morrow` へ変更した）。秘書の呼び名（「秘書」）と会話文はこの名称変更の対象外。

| 項目 | 値 |
|---|---|
| 本番URL | `https://aide-bot.gucchii.com/` |
| 本番ポート | `3103`（PM2 プロセス名 `aide-bot`） |
| 配布先 | VPS の `/home/github-user/apps/aide-bot/`（app-deploy-gate のアプリ名も `aide-bot`。#567） |
| データベース | `app_aide_bot`（MariaDB / Prisma） |
| 認証 | Supabase Auth（Google）。他アプリと共有のSupabaseプロジェクト |
| パッケージマネージャ | pnpm（`packageManager` は10系に固定。VPSのNodeが20系のため11系は動かない） |

**ポートの正は `vps` リポジトリのアプリ一覧**（[ports.md](https://github.com/guchi-apps/docs/blob/main/standards/ports.md)）。
`deploy/ecosystem.config.js` と `.github/workflows/deploy.yml` の既定値がそれに揃っている。

**`PORT` はシークレットではなく設定値として扱う。** 1Passwordにも `.github/secrets-manifest.tsv` にも置かず、
`deploy.yml` の「Send environment variables」ステップに平文で持つ（ports.md「ポート番号は 1Password で管理しない」）。
GitHub変数 `vars.PORT` は使わない。マニフェストへ戻さないこと（#5）。

## このリポジトリの構成（エージェント向けの前提）

```
src/app/          画面とRoute Handler（App Router）
src/components/   画面のUIコンポーネント（機能ごとのディレクトリに分ける）
src/lib/          Supabaseクライアント・Prismaクライアント・共通ユーティリティ
src/proxy.ts      Next.js 16のミドルウェア。全リクエストのセッション検証を担う
prisma/           スキーマとマイグレーション
deploy/           PM2設定
scripts/          開発・デプロイ補助スクリプト
.github/          CI・デプロイ・マルチエージェント運用のワークフロー
```

## 認証

- Supabase Auth の Google プロバイダを使う。セッションの検証は `src/proxy.ts`（→ `src/lib/supabase/middleware.ts`）が
  **1リクエストにつき1回だけ**行い、結果を `x-aide-bot-supabase-user-id` ヘッダーで後段へ渡す。
  ページやRoute Handlerで `auth.getUser()` を呼び直さない（Supabaseへの往復が倍になる）
- ログイン中のユーザーは `getCurrentUser()`（`src/lib/auth-user.ts`）で取得する
- **ログインの許可はStatusHubの共通アクセス設定が正**（#513。`guchi-apps/status-hub` の `docs/access-control.md`）。
  管理画面で追加・取り消しすれば、再デプロイなしで反映される。判定は `src/lib/access/client.ts`
  （契約の部分は `decision.ts`）に閉じ、アプリID `morrow`・アプリ別トークンは issue-deck の共有トークン
  `MORROW_ACCESS_APP_TOKEN` から読む。**旧 `ALLOWED_GOOGLE_EMAILS` は判定にもフォールバックにも使わない**
  （使うと、StatusHubで取り消した利用者が通る）。判定APIへ届かないときは直前の判定を最大5分だけ使い、超えたら・
  一度も判定できていなければ**拒否**（トークン未設定も全員拒否）。`ttlSeconds`（30秒）のキャッシュと
  ハートビート（`src/instrumentation.ts`。4分ごと）も契約どおり
- **「判定できなかった」と「許可されていない」を分ける**（#537）。判定APIから答えを得られず拒否した回は
  `isAccessUnavailable()`（`decision.ts`。クライアントだけが立てる印で、応答の `reason` からは読まない）が真になり、
  middlewareは**セッションを破棄せず**503の画面（再読み込み・ログイン画面へのリンク）を返す。`/auth/callback` は
  `/login?error=access_unavailable`（iOSの殻へは `auth_failed`）、`/auth/native/consume` は503。「許可されていません」と
  出すと、設定不足を権限の取り消しと取り違える。**本番で `SHARED_TOKEN_API_SECRET` がGitHubへ同期されておらず、
  issue-deckにも `MORROW_ACCESS_APP_TOKEN` が無いまま #513 が出て全員が拒否された**のが#537。ログの
  「アクセス判定の取得に失敗」の括弧内が、取りに行けない（設定名）のか取得できない（404＝未登録）のかを示す
- **判定を通すのはログインの瞬間だけではない**（#246）。Supabaseのセッションはリフレッシュトークンで
  更新され続け、`User` 行も残るので、ログイン時だけ見ていると**取り消しても使い続けられる**。
  `getCurrentUser()` が引いた `User` に `isStoredUserAllowed()` を通してnullを返し（未ログイン扱い）、
  `src/lib/supabase/middleware.ts` が `getUser()` の結果に `isUserAllowed()` を通して**セッションごと破棄**
  （`signOutThisApp()`）して `/login?error=not_allowed` へ戻す。**片方だけにしないこと**——`getCurrentUser()`
  だけだと、ページが `/login` へ送り、middlewareが「ログイン済みは `/login` からトップへ」で送り返して
  リダイレクトが終わらない。開発用ログイン（Cookieバイパス）は対象外
- **送る主体はサーバーが検証したものだけ。** セッションがある経路は `toAccessSubject()`（Supabaseの `sub`・メール・
  確認済みか）。cron・遅延実行・起きた合図のようにセッションが無い経路は `isStoredUserAllowed()`
  （`User` 行の `supabaseUserId`・メール。行は判定を通ったログインからだけ作るので、確認済みとして送る。
  ログイン時と同じ `sub`＋メールなのでキャッシュも共有される）。ブラウザの申告は送らない
- 手作業が残る: 管理画面でアプリ `morrow` と権限を登録→トークン発行→移行CLI（`import`→`diff`）→「反映済み」の確認。
  **トークン発行・取り込みが済むまでは全員ログインできない**（未設定は全拒否）。旧設定（1Password・
  deploy.yml・マニフェストの `ALLOWED_GOOGLE_EMAILS`）の整理は、本番検証と復旧確認の後
- ログイン・ログアウトの導線はクライアントJSに依存させない。開始は `/auth/signin`（Route Handlerが
  認可URLを組み立てて302）、ログアウトはフォームのPOSTで `/auth/signout`。
  ハイドレーション前でも押せるようにするため
- **セッションを破棄するときは `signOutThisApp()`（`src/lib/supabase/sign-out.ts`）を通す**（#292）。
  Supabaseは他アプリと共有のプロジェクトで、`supabase.auth.signOut()` を引数なしで呼ぶと既定の
  `scope: "global"` になり、**同じユーザーの他アプリ・他端末のrefresh tokenまで失効する**。
  `signOutThisApp()` は `scope: "local"`（いまのセッションだけ）を渡す。通常のログアウト
  （`/auth/signout`）・許可外アカウントの破棄（`/auth/callback`・middleware）の3か所がこれを通る。
  `test/sign-out.test.ts` が、`src/` に直接の `.signOut(` が残っていないことも確かめる。
  **アカウント自体を削除する操作は無い**。作るなら、全セッションを終わらせる意図をその場で明示すること

### ログイン後の戻り先（`safeInternalPath()`。#140）

`callbackUrl` / `next` は外から与えられ、最後は `new URL(値, オリジン)` かリンクの `href` へ渡る。
**判定の正は `isInternalPath()`（`src/lib/safe-path.ts`）1か所**で、お知らせの遷移先
（`safeNoticeUrl()`。#137）も同じ関数を通す。片方だけに対策を入れると、もう片方が同じ穴を
持ったまま残る——実際 #137 で `notice-url.ts` にだけ入れた `/\` の対策が #140 まで
`safe-path.ts` へ入っていなかった。

- **「`/` で始まり `//` で始まらない」だけでは足りない。** URLの解釈ではバックスラッシュが
  スラッシュとして読まれるため、`/\evil.example.com/` が `new URL()` の時点で
  `http://evil.example.com/` になる（#140でmiddlewareの302を実測）。`/^\/[/\\]/` で両方落とす
- **タブ（`%09`）・改行（`%0A`）・復帰（`%0D`）が混ざった値も外部へ出る。** URLの解釈では
  これらが**取り除かれる**ため、`/%0A/evil.example.com/` は `//evil.example.com` として
  読まれ、上の判定を素通りする。パスとして正当な値ならこれらは必ずパーセントエンコード
  されているので、制御文字・空白（`<= 0x20` と `0x7f`）を含む値はまとめて受け付けない
- **`public/sw.js` の `safeTarget()` にも同じ判定を二重に持っている**（ビルドを通らない素のJSで
  importできない。#137から続く制約）。**片方だけ直さないこと**——`pnpm test:unit` の
  `test/sw-parity.test.ts` が `sw.js` を読み込んで、同じ入力を流した結果を突き合わせる（#248）

### 開発用ログイン（Cookieバイパス）

**エージェントは対話的なOAuthを完了できないため、ログイン後の画面はこの導線からしか見られない。**
判定は `src/lib/ci-auth-bypass.ts` に閉じてあり、`src/lib/supabase/middleware.ts` と
`src/lib/auth-user.ts` の**両方**が同じ判定を行う（middlewareだけ通してもデータが引けない）。

```bash
pnpm db:seed:dev   # ダミーユーザーを投入し CI_LOGIN_BYPASS_SECRET を .env.local へ生成する
pnpm dev           # 生成した値は再起動しないと効かない
curl -s -c /tmp/cookies.txt -o /dev/null -w '%{http_code} -> %{redirect_url}\n' \
  -X POST http://localhost:<ポート>/api/dev/login          # 303 -> /
curl -s -b /tmp/cookies.txt -o /dev/null -w '%{http_code}\n' http://localhost:<ポート>/   # 200
```

- **本番で有効にならないことを二重に塞いでいる。** `NODE_ENV=production` での無効化と、
  `CI_LOGIN_BYPASS_SECRET` 未設定での無効化。**片方だけ緩めない**
- ダミーユーザーの `supabaseUserId` は `ci-screenshot-bot`。値は `src/lib/ci-auth-bypass.ts` と
  `scripts/seed-ci-db.mjs` に二重に持っている（後者はプレーンJSでTSをimportできない）。
  **片方だけ変えると、ログインは通るのに画面が `/login` へ戻り続ける**
- **画面に出るモデルを追加したIssueは、同じPRで `scripts/seed-ci-db.mjs` へダミーデータも足す。**
  認証を抜けても開発DBが空なら画面は空のままで検証にならない
- シークレットの実値はコミット・PR本文・Issueコメント・ログのいずれにも書かない

## iOSアプリ（#441）

`ios/` に、Webを開くSwiftUI＋WKWebViewの殻を持つ（Bundle ID `com.gucchii.morrow`・iOS 18以上。**対象デバイスはiPhone＋iPad（`TARGETED_DEVICE_FAMILY = "1,2"`。#482）。`1` だけだとiPadがiPhone互換モードになりiPhoneサイズで表示される。**方式はYoteiFlowの
`ios/` を移植）。**画面・機能はWebが正本**で、殻は「開く・Googleログインを認証シートで往復する・通信失敗で再試行させる」だけ。
詳細・手順は `ios/README.md`。

- **GoogleはWebView内ではログインできない**（`disallowed_useragent`）。認証シート（`ASWebAuthenticationSession`）と
  WKWebViewはCookieを共有しないので、`GET /auth/native/start`（PKCEのchallengeを持って開始）→ `/auth/callback?native=1`
  （**許可判定・User作成は既存と同じ箇所**。通ったら一度限り・60秒の引き継ぎコードだけを `morrow://auth-callback` で返す）→
  WebViewから `POST /auth/native/consume`（コード＋verifier）で通常のSupabase Cookieを受け取る。**トークンはURL・ログ・
  Swiftに出さない**。失敗の理由は区別せず同じ拒否。consumeでも許可リストを再確認する（#246）
- **`/auth/native` はmiddlewareの公開パス**（認証シートはCookie無し、consumeはログイン前に呼ぶ）。**認証の判定を足すときは
  ここも見ること**
- **引き継ぎ行（`NativeAuthHandoff`）のトークンは暗号化して置く**（`src/lib/native-auth/cipher.ts`）。専用の鍵は無いので、
  サーバーだけが持つ `VAPID_PRIVATE_KEY` からHKDFで用途専用の鍵を導く。**未設定ならログインの引き継ぎごと閉じる**
  （平文に落とさない）。VAPID鍵を差し替えると、その時点で発行済みの引き継ぎ行（60秒）が読めなくなるだけ
- ログアウトはWebのフォーム（`/auth/signout`）のまま `signOutThisApp()`（scope: local）を通る。共有Supabaseの他アプリ・他端末は巻き込まない
- **戻り先スキーム・横取りするパス・同一オリジン判定・エフェメラルはSwift（`ios/Morrow/`）とTS（`native-app.ts`）で二重に持つ**。
  `test/ios-consistency.test.ts`（`ios/scripts/check-consistency.mjs`）が照合する。**本番URL以外をコミットしない**
- Web更新はデプロイだけで反映され、殻（`ios/`）を変えたときだけ新しいビルドをTestFlightへ上げる。**#448から、mainの
  `Deploy to Production` 成功後に `ios-testflight-trigger.yml` → `ios-testflight.yml`（macOSランナー）が自動で内部テストへ
  配る**（YoteiFlow・kurashioと同じ方式）。`ios/Morrow/`・`ios/Morrow.xcodeproj/` に実質的な差分があるときだけビルドし
  （判定は `ios/scripts/ios-changes.mjs`。`ios-rebuild-notice.yml` も同じ関数）、配った印はタグ `ios-testflight/<ビルド番号>`。
  **`MARKETING_VERSION` は `package.json` と一致が必須**（ずれると配布ジョブが止まる）。`scripts.version` が
  `sync-version.mjs` を呼ぶので版上げで揃う。**CIの書き出しは `ios/scripts/ExportOptions.plist`（export）で、手動用
  `ios/ExportOptions.plist`（upload）と別**——uploadのまま使うと二重アップロード防止が効かない。ASCのAPIキーは
  `apps/AppStoreConnect`（マニフェストの `ASC_*`）。**subpcにXcodeは無い**ので、手動ビルド・実機確認はMacで本人が行う

### iOSアプリへのAPNs通知（#475）

WKWebViewにはPushManagerが無いので、殻がAPNsのトークンを取って `POST /api/push/apns` へ登録し、`sendPushToUser()`
（`src/lib/push/subscriptions.ts`）が**Web Pushと並べて**APNsへも送る。詳細・手作業は `ios/README.md`。

- **「通知を送れる端末があるか」は `countSubscriptions()`・`usersWithSubscriptions()` を必ず通す**（Web購読＋`ApnsDevice`の合算）。
  `pushSubscription` だけを数えると、アプリだけで受け取る利用者が起きた合図（#233）で `no_device` に断られ、設定・話題の画面も
  「端末なし」のままになる。**`sendPushToUser()` のVAPID未設定の早期returnはWeb Push側だけ**（APNsだけの構成でも送る）
- **認証情報（`APNS_KEY_ID`・`APNS_TEAM_ID`・`APNS_KEY_P8`）は3つ揃わないとAPNsの経路ごと無効**（`apnsCredentials()` がnull。
  登録APIも503）。外部（Apple Developer）で発行する値で機械生成できない。正は `apps/AppStoreConnect` の
  「Apple Push Notification service (APNs)」セクション（`apns-key-id`・`apns-team-id`・`apns-auth-key`）に置く。未設定でもWeb Pushは止まらない
- **依存は足していない**（Node標準の `http2`・`crypto`）。DB・ネットワークに触れない部分は `apns-core.ts` に切り出し、
  `test/apns.test.ts` が固定する。送信本体（`apns.ts`）はPrismaを引くので読めない——手元では `APNS_ORIGIN_OVERRIDE`（テスト専用）を
  自己署名のHTTP/2スタブへ向け、`NODE_TLS_REJECT_UNAUTHORIZED=0` で確かめられる（410で行が消えること・`apns-topic` 等のヘッダ）
- **失効の判定は `shouldDeleteToken()`**（410と、トークン無効の400だけ消す）。`DeviceTokenNotForTopic`・`BadEnvironment` は設定の問題で、消しても直らない
- アプリの端末の見分けはUAの `MorrowIOS/`（`deviceLabelFromUserAgent()`・`notification-settings.tsx`）。アプリ内ではWeb Pushの購読UIを出さず、状態と「試しに送る」だけ
- 通知の遷移先（`url`）は殻の `AppConfig.notificationTarget()` が `isInternalPath()` と同じ考え方で検査する（`//`・`\`・制御文字を弾く）。
  `ios/scripts/check-consistency.mjs` が一部を照合する

## Route Handlerのリクエスト本文（#262）

**本文はJSONの `null` でも「読めた」ことになる。** `request.json()` は本文が `null` なら `null` を返す
ので、`(await request.json()) as Body` と型を当てたまま `body.x` を読むと、`null` のときだけTypeErrorで
500になる。画面からは出ない入力（手で叩いた・外部アプリ）だが、呼ぶ側は500からは原因を切り分けられない。

- **オブジェクトとして読むのは `readJsonObject()`（`src/lib/json-body.ts`）に閉じる。** JSONとして
  読めない・`null`・数値・文字列・配列はまとめて `null` を返すので、呼び出し側は400を返す。
  新しいRoute Handlerで本文を読むときは `request.json()` を直接呼ばない
- **MCP（`/api/mcp`）だけは形の違う本文を400ではなくJSON-RPCの `-32600`（`id` は `null`）で返す。**
  JSONとして読めない本文は従来どおり400。呼ぶ側がJSON-RPCの応答として読めるようにするため
- `POST /api/notices` は `parseNoticeInput()` が同じ判定を持っているので `request.json()` のまま

## チャット（相談）と音声は廃止した（#574）

**相談・音声対話はChatGPTで代替するため、Morrowからチャットをやめた**（#573でダッシュボードと通知の遷移先を
移した後の#574）。Morrowは「集めて・選んで・届ける」だけを持つ。

- **消したもの**: `POST /api/chat`、「書く」画面・音声バー（`src/components/chat`の相談関連・`src/components/voice`・
  `src/lib/speech/`）、会話の要約（compact）・会話の区切り・継続記憶（`/memory`）、会話からの設定変更・書き込み前の
  確認カード、自宅の前提の取り込み、声かけ・秘書の一言、書き込みの道具の許可設定（`WriteToolPicker`・Cookie）、
  「モデル」の画面の相談専用の用途（話す・書く・要約・自宅の前提・継続記憶）、過去の日の画面（`/d/<日付>`）・左メニューの日付一覧
- **残したもの**: 朝の見通し・起きた合図（#79・#233）、お知らせの受け皿と急ぎのPush（#93・#115）、話題の仕入れと
  定時のお知らせ（#144・#344・#362）、先回りの提案（#325）、通知の種類ごとのオン・オフ（#488）、使用量の記録と
  `/api/ai-usage`（#297）、`/c/<ID>` の転送（古い通知のURL。「届いた通知」（`/pushes`。#581）へ飛ばすだけ。消さない）
- **DBのテーブル・列は#575で落とした**（`Conversation`・`Message`・`ToolCall`・`ContextBreak`・`Memory`、`User.homeProfile*`、
  `ApiUsage.conversationId`・`NotificationLog.conversationId`）。`User.modelSettings` は朝の見通しなど4用途で使うので残す。`ApiUsage.feature` の `chat`・`compact`・
  `home_profile`・`memory` は移行前の行の名前としてだけ残している（`USAGE_FEATURE_LABELS`）
- **通知の本文の読み先は `NotificationLog`**（ダッシュボードの「今日届いた通知」）。朝の見通し・急ぎ・先回りの提案・朝のニュースは、
  もう相談へ積まない（`appendSecretaryExchange()` は無い）
- **ニュースの仕入れの起点は、ダッシュボードが叩く `/api/notices/current`（応答後の `refreshTopicsIfStale()`）と、
  定時のお知らせの直前（cron）の2つ。** ダッシュボードの `NoticeLiveProvider`（`use-notice-poll.ts`。3分ごと・見えている間だけ・
  1時間触られなければ休む）が唯一の問い合わせなので、**外さないこと**。`/api/notices/current` は `{ notice }` だけを返す
  （ひとりごと・話題の輪・声かけは無い）
- **`src/lib/anthropic.ts` はファイル名に反してSDKを使っていない**（#183）。朝の見通し・先回りの提案・お知らせ選定の
  プロンプトの置き場。**アプリからAnthropic（Claude）を呼ぶ経路はもう無い**（`ANTHROPIC_API_KEY`・`@anthropic-ai/sdk` も無い）。
  使ったトークン量は#133から `ApiUsage` へ記録している（費用が付かないだけ）
- 戻すなら履歴（PR #574より前）から拾う

### 秘書の人格（#226）

**人格の正は `src/lib/persona.ts`。** 「身元の一文」（`SECRETARY_INTRO`）と「話し方の決まり」
（`SECRETARY_VOICE_RULES`。一人称「わたし」・丁寧で温かい・押しつけない・労いは結論の後に一言）を
分けて持つ。名前は付けていない（呼称は「秘書」のまま）。

- **話し方を足すのは、利用者に見える文を書かせる経路だけ**——朝の見通し・先回りの提案・お知らせの一言・話題の `lead`
- **体裁の決まり（文字数・行の形）が人格より優先。** 話し方の最後の1項目でそう指示し、プロンプトでも
  体裁の指示を後ろに置いてある。通知の200文字・吹き出しの40文字は変えていない
- **モデルを呼ばない定型文は手で同じ口調に揃える**

### 返答の生成をCodex CLI経由にした（#128）

返答の生成元をAnthropic ClaudeからOpenAI Codex CLI（ChatGPTのサブスク枠で動く）へ移した（#128。
その後#132・#167・#183で全経路が移り、**Claudeを呼ぶ経路は残っていない**）。#574で相談を廃止したので、
いま使うのは朝の見通し・先回りの提案・お知らせの選定・話題の仕入れ。以下はCodexを呼ぶ全経路に共通の事実。

- **`turn.completed` の `usage` にトークン数が載る**（#133）。取れないのはChatGPTサブスクの
  利用枠（5時間ローリング・週次）の消費率だけ。`runCodexExec()` はこれを `CodexResult.usage` で
  返し、呼び出し側が `ApiUsage` の1行として残す（「APIの消費量」を参照）
- **`codex exec --json` はトークン単位でストリーミングしない。** 実機確認では、応答全体が
  1つの `item.completed`（`item.type === "agent_message"`）イベントとして届いた。本文は完了時にしか届かない
- **サンドボックス設定で用途に絞る。** Codexはコーディングエージェントの性質上
  シェル実行・ファイル改変のツールを持つため、`--sandbox read-only` ・`--ephemeral`
  （セッションを永続化しない）・`--ignore-user-config`（利用者の`~/.codex/config.toml`の
  MCP設定等を持ち込ませない）・`--skip-git-repo-check` を付け、作業ディレクトリ（`-C`）も
  プロジェクトのルートではなく `os.tmpdir()` に切り離す
- **プロンプトは引数ではなく標準入力で渡す**（#244）。引数は `-` にして `child.stdin.end(prompt)`
  （`stdio: ["pipe", …]`）。**引数で渡すとLinuxの1本あたりの上限（`MAX_ARG_STRLEN`＝128KiB）を
  超えた時点で `spawn` が同期で `E2BIG` を投げる。** 日本語はUTF-8で3バイトなので約4.3万文字で、
  長いプロンプトは数万文字になりうる。本文が `ps` に見えるのも
  同じ理由で避けたかった。**引数に本文を残したまま標準入力もパイプすると**「Reading additional
  input from stdin...」の案内とともに標準入力が `<stdin>` ブロックとして追記される（`codex exec --help`
  にもある）ので、**引数は必ず `-`。** 子が入力を読む前に終わると書き込みが `EPIPE` になるため、
  `child.stdin` の `error` は握りつぶしている（失敗は `error` / `close` 側で扱う）。
  **端末から手で叩くときは、プロンプトを引数に置いたまま `< /dev/null` を付けるか、`-` を付けて
  `printf '…' | codex exec … -` で渡す**——標準入力がパイプされていて引数も付いていると、
  プロンプトが二重になるか、JSONLが1行も出ないまま待ち続けて「Codexが固まった」に見える（#132で実測）
- **子プロセスの環境変数は許可リストで絞る**（#258。`codexChildEnv()`、`src/lib/codex.ts`）。
  `process.env` を丸ごと渡すと、本番では `next start` が読み込んだ `DATABASE_URL`・`VAPID_PRIVATE_KEY`・
  `BRIEFING_TRIGGER_TOKEN`・`NOTICE_INGEST_TOKEN` がモデルの実行する `env` に見える（`--sandbox read-only` は
  読むことを止めない）。**モデルへ食わせる文字列は外から来る**（`--search` のニュース・MCPの道具の結果）ので、
  プロンプトインジェクションが入るとシークレットが外へ出る。渡すのは `PATH`・`HOME`・`CODEX_*`（認証情報の
  置き場 `CODEX_HOME` を含む）・`XDG_*`・ロケール・プロキシ・証明書だけで、MCPのアクセストークン
  （`AIDE_BOT_MCP_TOKEN_*`）はそこへ足す。**Codexが動かなくなったら値を足す前に、Codexのどの機能が
  その変数を読むのかを確かめる**（`test/codex-env.test.ts` が名前の表で固定している）
- **モデルのシェルへ渡す環境は、子プロセスの環境とは別に絞る**（#258）。`shell_environment_policy.inherit="core"`
  と `allow_login_shell=false` を常に付ける。実測（`codex-cli 0.152.1`）で、**子プロセスの環境を絞っても
  `AIDE_BOT_MCP_TOKEN_*` はモデルの `env` にそのまま出た**（名前に `TOKEN` が入っていても既定の除外は
  効かない）。ログインシェルが読む利用者のプロファイルが足す変数（`OP_SERVICE_ACCOUNT_TOKEN` など）も出た。
  MCPのトークンを読むのはCodex本体なので、この設定でも接続先へ繋がり道具も呼べる（スタブMCPで
  `initialize`・`tools/list`・`tools/call` のすべてに `Authorization: Bearer` が付くことを実測）
- **`codex exec --search` でウェブ検索させられる**（`Enable live web search. When enabled,
  the native Responses web_search tool is available`）。**まだ使っていない**が、外部情報を
  取らせたくなったとき、検索用のサービスを新たに契約する前にこちらを検討すること——
  同じサブスク枠で動くので、APIキーも依存パッケージも増えない（#144で検討中）
- **アカウントが対応していないモデルは、GPT-5.6系へ1度だけ落としてやり直す**（#358）。`models_cache.json` に載っていても、
  ChatGPTアカウントの契約によっては実行時に `The 'gpt-6-luna' model is not supported when using Codex with a ChatGPT account.`
  （400）で断られる（サブPCでは通り、本番のアカウントでだけ出た）。`runCodexExec()` が起動の時点でこのエラーが返った回だけ、
  `UNSUPPORTED_MODEL_FALLBACKS`（astra→5.6-sol、sol→5.6-terra、luna→5.6-luna）でやり直す。本文が届いた後は再実行しない。
  使用量の記録のモデル名は指定した方（GPT-6系）のまま。`test/codex-fallback.test.ts` が固定する
- **利用可能なモデル名を確認できるCLIコマンドは無い。** `~/.codex/models_cache.json` の
  `models[].slug` から拾う（2026-08-31時点: `gpt-5.6-sol` / `gpt-5.6-terra` /
  `gpt-5.6-luna` 等）。Sol＝旗艦（いちばん賢い）、Terra＝GPT-5.5相当の中位、Luna＝いちばん
  速く安いモデル（出典: https://openai.com/index/gpt-5-6/）
- **Next.jsのビルド時、`child_process.spawn` に動的な文字列（環境変数由来のコマンド名）を
  渡すと警告が出る。** 「ファイルパスかもしれない」とみなされ、静的トレースがプロジェクト
  全体をデプロイ成果物へ含めようとする。ファイルパスではなくPATH解決するコマンド名なら
  `/* turbopackIgnore: true */` を呼び出し直前に付けて対象から外す（`src/lib/codex.ts`）

## モデルの選択（#71・#128・#349）

**Codex CLIに渡すモデルは、用途ごとに「モデル」の画面（`/models`。設定とは独立）から選ぶ。** 選べるのは
`gpt-6-astra`（最高性能）・`gpt-6-sol`（バランス）・`gpt-6-luna`（高速）。#349でGPT-5.6系から移した
（5.6系は選択肢から外れ、過去の使用量の記録にだけ残る）。サブスクの定額制なので、賢さとサブスクの利用枠
（5時間ローリング＋週次）の減りの速さのトレードオフで選ぶ。

- **用途の正は `src/lib/chat-model.ts` の `MODEL_USES` / `MODEL_USE_META` / `DEFAULT_MODELS`。** 4用途
  （朝の見通し・先回りの提案・お知らせの選定・話題の仕入れ。#574で相談専用の5用途を消した。保存済みの値に
  残っていても `resolveModelSettings()` が読まない）。
  **用途を足すときは3つの表を揃える**（`Record<ModelUse, …>` なので漏れは型で落ちる）。既定は従来の役割に
  合わせた値（5.6のSol→Astra、Terra→Sol、Luna→Luna）。このモジュールはクライアントからもimportするので、
  PrismaやCodex起動に触れるものを持ち込まない
- **保存は利用者ごとのDB（`User.modelSettings`。Json）。Cookieは使わない**（#349で廃止）。読むのがcronや
  返答後の後始末（Cookieの届かない経路）でもあるため、全用途を同じ場所へ揃えた。**既定と同じ値は持たない**
  （`mergeModelSettings()`。既定を後から変えても追従できる）。読み出しは `modelFor(userId, use)`
  （`src/lib/chat-model-server.ts`。サーバー専用）。**Codexを呼ぶ経路は定数を直書きせずここを通す**
- **保存済みの値は必ず `resolveModelSettings()` を通す。** 知らない用途・モデル名（GPT-5.6系・書き換えられた値）は
  既定へ落とす。そのまま `codex exec -m` へ渡すと、存在しない名前で全生成が失敗する。
  読めなかった回も既定へ落として生成は止めない
- **更新は `PATCH /api/settings/models`**（`{ "<用途>": "<モデルID>" }`。渡した用途だけ。本文は
  `readJsonObject()`）。画面は選ぶとすぐ保存し、失敗したら選択を戻す
- **#349で設定画面の「返答のモデル」と、以前のCookie（`aide-bot-chat-model-*`）の選択は消えた。**
  Cookieの値は引き継いでいない（残っていても読まない）
- **単価表（`MODEL_PRICING`）と `billingKind()` は#634で消した。** 金額を出す画面（`/usage`）が無くなり、どこからも引かないため。
  使用量の金額を出す画面を戻すときは履歴（PR #634より前）から拾う
- 開発DBのシード（`scripts/seed-ci-db.mjs`）の使用量ダミーもGPT-6系にしてある。**`modelSettings` は
  シードしない**（null＝全用途が既定の状態を最初に確かめられるように）

## 今日のダッシュボード（#573）

**トップ（`/`）は今日のダッシュボード**（#573。相談は#574で廃止した）。
天気・予定（AIDE）・今日届いた通知・お知らせ・話題を並べる、見るだけの画面（`src/components/dashboard/dashboard-view.tsx`）。
朝の見通し・急ぎのお知らせ・先回りの提案の通知を押すとここへ着き、本文は「今日届いた通知」に出る。

- **天気・予定はモデルを通さず、AIDEのMCPを直接叩く**（`src/lib/mcp/direct-call.ts`）。依存は足さず、
  `initialize` → `notifications/initialized` → `tools/call` をfetchで送るだけ。応答はJSONとSSEのどちらも読み
  （`rpc-body.ts`）、`Mcp-Session-Id` が返れば付ける。接続は `listConnectedServers()`（トークンの更新もここ）から
  プリセットid `aide` で選ぶ。**`writeTools` に入っている道具は呼ばない**
- **「取得できなかった」と「無い」を混ぜない**（#214）。読み替えは `src/lib/dashboard/parse.ts`（純粋。
  `test/dashboard-parse.test.ts`）。天気は `state` ≠ `ok` を「予報が無い」、予定は `configured: false`・
  `complete: false`・`googleConnected: false` を「予定なし」と別に出す。形の読めない応答・通信失敗は赤の「取得できませんでした」
- **プロセス内で成功5分・失敗1分キャッシュする**（`src/lib/dashboard/aide.ts`。鍵に日本時間の日付を含む）。走っている
  取得は共有する。画面はスマホ用とPC用の2つの並びを描き分けている（CSSで片方を隠す）ので、これが無いとAIDEへ2本ずつ出る。
  未接続はキャッシュしない
- **ダッシュボードがお知らせの選定・ニュースの仕入れを動かす。** `/api/notices/current` はこの2つの起点で、チャット廃止（#574）後に
  アプリを開いたときに叩くのはここだけ。ダッシュボードは `NoticeLiveProvider`（`live-notice-line.tsx`）が `useNoticePoll()`
  （`use-notice-poll.ts`。3分ごと・見えている間だけ・1時間触られなければ休む）を**1本だけ**持ち、選ばれた一言を「いまの一言」に出す
  （出さずに消費しない。#114）
- **「今日届いた通知」の正は `NotificationLog`**（本文が空＝黙った回は出さない。定時のお知らせは `/topics` が受け皿なので除く）。
  通知は会話へ積まない（#574）
- **きのう以前の通知の本文は「届いた通知」（`/pushes`。#581）で読む。** ダッシュボードは今日の分しか出さず、#574で過去の日の画面
  （`/d/<日付>`）も消えたので、端末に残った前日以前の通知（`/`・古い `/c/<ID>`）を開いても本文へ辿れなくなっていた。
  条件は「今日届いた通知」と同じで日付の下限だけ外し、新しい順に `PUSH_HISTORY_LIMIT`（200件。上限で切れたら最も古い日の残りも足し、日の途中で切らない）まで日付ごとに出す
  （`pushHistory()`・`groupPushesByDay()`。後者は純粋で `test/push-history.test.ts`）。`NotificationLog` は消していないので期間では切らない。
  `/c/<ID>` は `/pushes` へ転送し、ダッシュボードのカードと左メニューから入れる
- 天気・予定は `Suspense` で後から流し、DBだけで出せる部分を先に描く
- **予定カードは「予定・記録」で、行を濃さで3つに分ける**（#626。判定は純粋な `src/lib/dashboard/schedule-phase.ts`・`test/schedule-phase.test.ts`）。記録＝AIDEの `calendarName` が「活動記録」（専用の項目は無いので名前で見る）を最も薄く、終わった予定（今日は終了時刻が現在より前・前の日は全部。予定と移動だけ。タスク・リマインド・時刻なしは対象外）を少し薄く、これからは従来の色。凡例は薄い行がある日だけ出す。「終わった」は描画時の日本時間との比較で、開いたままでは更新されない

### 前後の日へめくる（#606）

ダッシュボードは左右のスワイプ（`day-swipe.tsx`）と見出しの ‹ ›（`Link`）で前後の日へ移る。表示中の日は `/?d=YYYY-MM-DD`（`?d` なし＝今日。
通知の遷移先 `/` は変えていない）。日付の検証・丸め・呼び方は純粋な `src/lib/dashboard/day-offset.ts`（`test/day-offset.test.ts`）。

- **範囲は今日の前後 `DAY_RANGE`（7）日**。範囲外・読めない値はページ側（`resolveDayOffset()`）で端・今日へ丸める。Open-Meteoの取得
  （`open-meteo.ts`）もこの幅（`past_days`・`forecast_days`）で1地点1回のまま取る。幅を変えるときは両方が揃う
- **予定は `aide_schedule` の `offsetDays`**（今日だけ従来どおり `days: 3`。日付を自分で作らない）。キャッシュ（`cached()`）の鍵にずれを足してある
- **自宅の日別予報は今日・明日だけAIDE、それ以外の日は自宅の地点（AIDEの `location`）のOpen-Meteo**（`dashboardDayWeather()`）。地点が無い間は
  「この日の予報はありません」（`none`）で、取得失敗（赤）とは分ける。区間の自宅も同じ理由で、AIDEの2日に無い日は `unresolved`
- **今日以外では「いま」の状態（お知らせ・話題・現在地の天気）を出さない。** 未来の日は届いた通知も出さない。
  `NoticeLiveProvider` はどの日でも外さない（お知らせの選定・ニュースの仕入れの起点。上の節）
- **スワイプは、画面の左右24pxから始めた操作を無視する。横にスクロールできる要素（1時間ごとの帯）の上では、帯が0時／23時の端に着いたあとの引きだけをめくりに使う**（#620。帯が動く間は日が変わらない。判定は純粋な `day-swipe-edge.ts`・`test/day-swipe-edge.test.ts`。帯には `overscroll-x-contain` を付けてある）。iOSの殻は端からの
  スワイプを戻る・進むに使う（`allowsBackForwardNavigationGestures`）。移るのは `router.replace`（‹ › も `replace`）で、日付めくりを履歴に積まない
- 天気・予定の `Suspense` は `key` に日付を入れてある。めくった直後に前の日の中身を残さず「取得しています…」を出すため

### 天気の地点・時間と場所ごとの雨・現在地（#586）

天気カードは、自宅の1日の予報（AIDE）に加えて、今日の予定の移動から作った区間（〜06:30 自宅 → 07:30–17:30 栗東市 →
18:30〜 自宅）ごとの天気と雨、天気カード先頭の「現在地」折りたたみ行（既定は畳む。押したときだけ取得。#625・#641）で現在地の天気を出す。明日・明後日の行き先の雨の一覧は#625で外した。

- **地点の名前・座標の正はAIDE**（`aide_weather` の `location`。guchi-apps/aide#673。`parseWeather()` は無ければnull）。AIDEが返すまでは見出しに
  市町村名を出さず、自宅の区間はAIDEの日別予報で代用する（「1日の予報」と添える）。Morrowの設定で自宅を持つ案は二重管理になるので採らなかった
- **行き先・現在地の予報と地名は、Morrowのサーバーからキー無しの公開APIを直接叩く**（依存は足していない）。予報はOpen-Meteo
  （`src/lib/weather/open-meteo.ts`。30分キャッシュ）、地名⇔座標は国土地理院の住所検索・逆ジオコーダ・市町村コード表
  （`geocode.ts`。24時間キャッシュ。解決できなかった地名も持つ）。座標は小数2桁（≒1km）に丸めてから外へ送る
- **行き先の材料は `travels[].destination`（無ければタイトルの `→` の右）と `events[].location` だけ。タイトルの括弧（「出張（門真）」）は
  読まない**（利用者の判断。誤読を避ける）。区間・判定・地名の選び方は純粋な `rain-check.ts`（`test/rain-check.test.ts`）
- **場所欄が空の予定は自宅に居るものとして区間にする**（#597。ラベルは予定のタイトル）。移動中・他の区間（移動前後の自宅・行き先）と
  重なる予定は足さない。明日以降は移動から作った自宅の区間（出発前・帰宅後）は出さず、この予定ぶんだけ出る。今日に行き先も場所欄も
  無い日は従来どおり「自宅 終日」の1行
- **地名の解決は推定。** 候補のうち「都道府県＋（地名）市/町/村/区」に一致するものだけを採り、複数あれば自宅に近い方（草津→滋賀県草津市）。
  住所が書かれていれば先頭の候補から逆ジオコーダで市町村名を引く。どちらでもない語（「本社」「京都駅」）は「場所不明」にする——
  見当違いの地点の天気を出すより「分からない」と出す方へ倒してある
- **場所欄は「店名 住所」の形が多く、丸ごと検索すると0件になる**（#597。「リラクゼーション ヘアサロン Bean's 大阪府堺市北区…」で実測）。
  `addressQueryOf()` が都道府県名から後ろを切り出す。都道府県が無ければ丸ごとのまま——「市・町・村・区を含む語」から切り出すと
  「区役所前」「町田」で見当違いの地点を拾いうるので、そちらへは広げていない（計画レビューの判断）
- **カードの行は、同じ場所（`home`・`placeText`）で重なる・接する区間を1つにまとめ**（#608。`mergeOverlappingStays()`。予定名は捨て、天気は区間全体で取り直す）、天気のアイコン・文字と降水確率だけを出す。**1時間ごとの帯は元の区間のまま**（`cellsFor()` へ渡すのは未マージ）。「◯時ごろから雨」は区間の行にも傘の注意にも出さない（区間の中は雨が続く前提のため。`rainFrom` は帯の注意と現在地で使う）
- 予定は `aide_schedule` を `days: 3` で1回だけ取り（`scheduleSource()`）、今日の予定（`parseSchedule()` は1日目だけ読む）と区間で共有する
- **1時間ごとの帯（#594）は、各時間の30分の時点に居る区間の地点の時間別予報**（`placeAtHour()`。純粋・`test/rain-check.test.ts`）。
  重なる時間は後に始まる区間を優先、区間と区間の間は「移動」（次の区間の予報）、最初の区間より前・最後の区間より後は自宅で埋める
  （行き先は22:00で切れ、明日の区間は自宅を含まないため。明日の列は `tomorrowStaysWithHome()` で自宅込みの区間を作る）。
  **自宅の地点（AIDEの `location`）が無い間・場所不明の時間は予報なし（「—」）で、日別予報では代用しない。** 予報は区間ごとに取得済みのもの
  （30分キャッシュ）を使い回し、外部への呼び出しは増やさない。キャッシュ（5分）には表示する日の0〜23時だけを持つ（#620。以前の「いまから24時間」＝翌0時以降は出さない）。**「今」の位置は
  描画側で決める**——キャッシュに時刻を焼き込まない。区間の行の「◯時ごろから雨」は `summarizeWindow()` の `rainFrom`
- **現在地は `POST /api/weather/here`**（ログイン必須・利用者ごと10秒に1回・位置は保存もログ出力もしない）。`navigator.geolocation` は
  HTTPSか `localhost` でしか動かない。**iOSアプリ（UA `MorrowIOS/`）でも出す**（#587）——殻のビルド設定に位置の利用目的
  （`INFOPLIST_KEY_NSLocationWhenInUseUsageDescription`）を持ち、WKWebViewがOSの許可ダイアログ経由で位置を渡す（Swiftの追加は無い）。
  利用目的を持たない古い殻では拒否として返るので、アプリ内の拒否の案内は「設定アプリで許可／最新版へ更新」にしてある
- 手元で確かめるときは、上のスタブMCPに `aide_weather`（`location` 付き・無しの両方）と `aide_schedule`（`days` を受ける）を答えさせる
- 手元では、ローカルのスタブMCP（`initialize` と `tools/call` に答えるだけ）を立て、`McpConnection.url` と
  `MCP_PRESETS` の `aide` の `url` を一時的にそちらへ向けて確かめる（**`presets.ts` は戻すこと**）。シードは
  AIDE接続を `enabled: false` で入れるので、そのままでは「未接続」が出る

## プロアクティブ通知（#79）

**このアプリで唯一、利用者が開いていないときに動く仕組み。** 毎朝1回、AIDEから今の状況を取り、
秘書の言葉で短くまとめて端末へWeb Pushで届ける。押すとダッシュボード（`/`）が開き、本文は「今日届いた通知」で読める。

配る先は**aide-bot自身のWeb Push**（#77で決定）。Signalyへ流す案は、通知を押した先がSignalyのPWAになるため採らなかった。

- **起動は外に任せる。** 常駐プロセスを足さず、`guchi-apps/vps` の `cron/crontab.txt` から
  `POST /api/briefing` を叩く（AIDEの `src/worker/run.ts` と同じ考え方）。認証は共有シークレットの
  Bearer（`BRIEFING_TRIGGER_TOKEN`）。**未設定なら経路ごと401で閉じる**——「未設定なら誰でも
  叩ける」にすると、設定漏れがそのまま公開エンドポイントになる
- **`public/sw.js` を置いたら `src/proxy.ts` のmatcherから必ず外す。** 除外パターンに `.js` は
  入っていないため、置いただけでは `/sw.js` がmiddlewareを通り、未ログイン時に `/login` への
  302がHTMLで返って `navigator.serviceWorker.register()` がMIMEタイプ違いで失敗する。
  `manifest.webmanifest` とまったく同じ失敗。**実際に `/other.js` は307で `/login` へ飛ぶ**ので、
  除外が効いているかはそれと見比べれば分かる
- **Service Workerは通知の受け取りだけを担う。** `fetch` ハンドラを持たず、画面もAPIも
  キャッシュしない。画面の内容は都度サーバーから取るもので、古い内容を出す方が実害が大きい

### 読まれなくなる通知を作らない

AIDEの `src/worker/notify.ts` が「成功を毎回送ると `zaim-keep-alive`（毎時）だけで1日24件になり、
肝心の失敗が埋もれる」という失敗を既にしている。**「定期的に教えてくれる」をそのまま実装すると
確実に読まれなくなる**ので、次を最初から入れてある。

- **決まった時刻に送るのは1日1本まで。** `NotificationLog` の一意制約 `(userId, kind, dedupeKey)`
  で守る。朝の見通しの `dedupeKey` は**日本時間の日付**（`jstDayKey()`。`src/lib/day-key.ts`）。サーバーのタイムゾーンで
  作ると、UTCで動く環境では日付の境目だけがずれて同じ日に2本出る
- **抑制は生成の前に見る。** cronが二重に登録されていても、2回目はAPIを1回も叩かずに戻る
- **知らせることが無ければ黙る。** モデルが `BRIEFING_SKIP_TOKEN`（`NO_BRIEFING`）だけを返した回は
  通知も相談も作らず、記録だけ残す。**黙れることがモデルを通す唯一の理由**——材料の道具
  （`aide_schedule`・`aide_weather` ほか）は構造化JSONを返すので、定型文で組み立てるだけなら
  API費用は0円で済む
- **生成に失敗した日は記録を残さない。** 残すと、直った後に叩き直しても抑制が効いてその日は
  二度と届かなくなる
- **通知の失敗で他を巻き込まない。** `sendPushToUser()` は例外を外へ出さず、1人が失敗しても
  他の利用者ぶんは続ける

### 実装で踏むところ

- **押した先はダッシュボード（`/`）で、会話へは積まない**（#574。以前は `appendSecretaryExchange()` で連続セッションへ
  追記していた）。本文の読み先は `NotificationLog`（`todaysPushes()`）。**抑制の鍵・本文を残す書き込みは `NotificationLog` の1行**
- **材料はすべてAIDE（MCP）から取る。** aide-botはMCPクライアントを実装していないので、
  繋いでいる接続が0件なら書けるものが何も無い。**API呼び出しの前に諦める**（費用だけ掛かって
  中身が空になる）
- **材料が増えるほど「毎日書く」と「条件を満たした日だけ触れる」を分ける**（#116）。
  200文字の上限（`BRIEFING_FORMAT_RULES`）は材料が増えても変えていないため、全部を毎日
  書ける余地は無い。予定（`aide_schedule`）・天気（`aide_weather`）だけは毎日必ず書き（天気は `state` が
  `ok` の日だけ）、部屋（`aide_room_sensors`・`aide_aircon_status`）・システム
  （`aide_host_status`・`aide_uptime_monitors`・`aide_service_quotas`）はどれかの
  `problems` が空でないとき、支払予定（`aide_fixed_costs` の `upcoming`）は明日までに
  引き落とされるものがあるとき、放置しているセッション（`aide_claude_sessions`）は
  `status: waiting` かつ `statusForMinutes` が30分以上のとき、確認待ちの滞留
  （`aide_dev_status` の `attention` のうち `00.check-user`）は1件以上のときだけ触れる
  （`BRIEFING_MATERIAL_RULES`、`src/lib/anthropic.ts`）。**道具そのものは条件を満たすかに
  関わらず毎日呼ぶ**——呼ばないと条件を満たすかどうか判断できない
- **しきい値の数値は `MORNING_BRIEFING_REQUEST` ではなくシステムプロンプト側に置く**（#116）。
  依頼文は自然な日本語に保ちたく、「30分以上」のような技術的な詳細を持ち込みたくない。依頼文には材料の名前（支払い予定・放置しているセッション・確認待ち）だけを
  自然な日本語で足してある
- **道具は10本（予定、天気、部屋2本、システム3本、支払予定、放置セッション、確認待ち）。**
  #116で4本、#296で6本から増やした。**#296はAIDE#373（MCPツールを「1つの問い」ごとに分け直した）への
  追従**で、`aide_daily_briefing`・`aide_room_status`・`aide_ops_status`・`aide_money_summary` は
  AIDE側に無い。**呼び出しが増えても抑制は変わらない**——1日1本の判定（`NotificationLog`）も
  `BRIEFING_SKIP_TOKEN` も生成の**前後**で見ており、道具の本数に依存しない。呼ぶ道具を足すときは
  AIDEの `main` に載っていることを確かめてから（先に直すと、無い道具を呼んで空の見通しになる）。**#183でCodexへ移ったので `MAX_TURNS`（`pause_turn` の頼み直し）は
  消えている**——往復の管理はCodex側の仕事になった
- **朝の見通しに渡す道具は材料の10本だけ**（#367。`MCP_PRESETS` の `briefingTools`、`toCodexMcpServers(…, "briefing")`）。
  許可リストを持たない接続（Notionなど）は**そもそも渡さない**。材料の道具を足すときは `BRIEFING_MATERIAL_RULES` と
  `briefingTools` を揃える（`test/mcp-write-policy.test.ts` が名前の一致と読み取り専用であることを固定する）。
- **モデルは用途「朝の見通し」（`briefing`。既定はAstra。#349から「モデル」の画面で選べる）。** 利用者ごとのDBに持つので、選ぶ主体が
  居ない場面（cronから叩かれる）でも読める。プロンプトキャッシュも効かない（1日1回では保持時間の
  5分をとうに過ぎている）
- **消費量は「呼び出し1回＝`ApiUsage` 1行」**（#51）
- **書き込みの道具は設定によらず常に止める**（`toCodexMcpServers(servers, false)`。#78）。
  朝の見通しは利用者のいないところで動いており、**登録の前に復唱して確かめる相手がいない。**
  システムプロンプトは `briefingServiceRules()`（`src/lib/anthropic.ts`）に持つ
- **VAPIDの公開鍵を `NEXT_PUBLIC_*` に置かない。** 公開鍵は本来公開してよい値だが、**ビルド時にバンドルへ焼き込まれ、
  鍵を差し替えるたびに再ビルドが要る**ため。設定の画面（サーバーコンポーネント）が
  `pushPublicKey()` で読んでpropsで渡す
- **`web-push` はhttpsのendpointしか受け付けない。** ローカルで送信まで確かめるときは、
  自己署名証明書のhttpsスタブを立て、`NODE_TLS_REJECT_UNAUTHORIZED=0` を付けて開発サーバーを
  起こす。httpのスタブへ向けると `EPROTO ... wrong version number` で落ちる
- **送信の失敗はステータスコードだけをログに出さない。** DNS・TLS・接続拒否では `statusCode` が
  付かず「不明」としか残らない。原因はほぼ例外のメッセージ側にある
- **404 / 410 で返った購読はその場で消す。** 通知を切られた端末・ホーム画面から消されたPWAの
  購読は二度と復活せず、残すと毎朝失敗し続ける
- **iOSのWeb Pushは16.4以降、かつホーム画面に追加したPWAでのみ動く。** Safariのタブで開いて
  いるだけでは `PushManager` そのものが無い。設定の画面はこれを先に案内する（出さないと
  「通知が来ない」という不具合に見える）

### 朝の見通しをCodexへ移した（#183）

**最後まで残っていたAnthropic（従量課金）の経路をCodex CLI（ChatGPTのサブスク枠）へ移した。**
#128（相談）・#132（お知らせ選定）・#167（自宅の前提）に続く4本目で、**これでアプリから
Claudeを呼ぶ場所は1つも無い**。移せるようになったのは#131でCodexからリモートMCPへ繋げるように
なり、`disabled_tools` で書き込みの道具を名指しで止められると分かったため（#151が「移せない」と
した理由が消えた）。**通知の文面・時刻・1日1本の抑制・お知らせの受け皿への投入は変えていない。**

- **形は自宅の取り込み（#167、`src/lib/home-profile.ts`）に揃えてある**——`toCodexMcpServers()` で
  繋ぎ先を作り、`runCodexExec()` を1回呼び、`usage` → `interrupted` → `errorMessage` の順に見る。
  **読むのは `result.reply`（`text` ではない）**——道具を呼んだ回は「確認します」の一言が別の
  `agent_message` として先に届くので、`text` を通知の本文にすると前置きごとロック画面へ出る（#131）
- **材料の10本はまとめて一度に呼ばせる。** Codexへ渡す接続には `supports_parallel_tool_calls=true` が
  付いている（`src/lib/codex.ts`）が、**まとめるかどうかを決めるのはモデル**なので、
  `briefingServiceRules()`（`src/lib/anthropic.ts`）にも「順に呼ばず一度にまとめて呼ぶ」を置いてある。
  順に呼ばれると道具1本あたり約9秒（#131の実測）ぶん往復が伸びる
- **上限は180秒**（`CODEX_TIMEOUT_MS`）。自宅の取り込み（120秒）より長いのは、**誰も画面の前で
  待っていない**ため。掛かった回は失敗として扱い、**その日の記録を残さない**ので次のcronの起動で
  やり直せる（#79の「生成に失敗した日は記録を残さない」のまま）
- **`max_tokens` に当たる引数が無い**（#132と同じ）。`BRIEFING_MAX_OUTPUT_TOKENS`・
  `MCP_TOKEN_ALLOWANCE`・`MCP_BETA` は消した。長さの歯止めは `BRIEFING_FORMAT_RULES` の
  「200文字以内」だけになっている
- **`ANTHROPIC_API_KEY` と `@anthropic-ai/sdk` を消した。** deploy.yml・
  `.github/secrets-manifest.tsv`・`.env*.example` からも外してある。1Passwordのアイテムは
  残っているが、どこからも読まない。**Messages API用の `toMcpRequestParts()` も消えている**ので、
  繋ぎ先を組み立てる口は `toCodexMcpServers()` の1つだけ
- **`/usage` は#634で画面ごと廃止した**（記録の保存と `/api/ai-usage` は残している）
- **開発DBのダミー（`scripts/seed-ci-db.mjs` の `BRIEFING_USAGE_MODEL`）はClaudeのまま残してある。**
  朝の見通しの既定のモデルと揃えると従量課金の節が常に空になり、その節の表示が壊れていても画面から
  気付けない。**片方だけ変えないこと**という向きが#183で逆転している

### 届く時刻を変える（#121）

**既定は7:00だが、設定の画面（`briefingHour`/`briefingMinute`。`User`テーブル）から
30分刻みで変えられる。** Cookieにしないのは他の設定（返答のモデル・書き込みの道具）と同じ
理由——読むのがcronから叩かれる利用者のいない経路で、そこにはCookieが届かない。

- **判定は「設定時刻を過ぎた最初の起動で送る」方式。** cronの起動頻度そのものを利用者ごとに
  変えることはできないため、`runFor()`（`src/lib/briefing.ts`）の先頭で
  `jstMinuteOfDay(now) < briefingHour*60+briefingMinute` を見て、過ぎていなければAPIを
  1回も叩かずに戻る。既存の「今日ぶんもう送ったか」（`NotificationLog`）より**先に**見る
  ——DBを引かない分こちらの方が軽い
- **30分刻みにしか対応しない。** cronの起動頻度（vps側`cron/crontab.txt`。#168で追加）と
  釣り合わせた粒度で、それより細かく選べても実際に届く時刻の精度は上がらない。頻度を
  変えるときは両方（画面の選択肢とcrontabの`*/N`）を一緒に見直すこと
- **「起きた時間に合わせたい」は#121のスコープ外だった。** #233で起きた合図を受け取れるように
  なり、合図を送っている日は、この時刻が「遅くともこの時刻」の意味になる（下記）

### 起きた合図で届ける（#233）

**iPhoneの個人用オートメーション「アラーム ▸ 停止したとき」から `POST /api/briefing/wake` を叩くと、
朝の見通しをその場で作って届ける。** 合図が届かなかった日（休日・アラームを使わない日）は、これまで
どおりcronが設定時刻に送る。起床の判定そのものは持たず、**睡眠を記録しているdayspanの判定を使う。**

- **「アラームを止めた」は「起きた」ではない。** dayspanの `/api/shortcuts/sleep/stop` は、睡眠を
  記録していなくても `ok: true`（`status: "not_running"` / `"other_running"`）を返し、記録中の睡眠を
  止めたときだけ `status: "saved"` を返す。ショートカットはその `status` を「もしも」で見て、`saved` の
  ときだけこちらを叩く（手順は設定の画面の `WakeTriggerCard`）。**アプリ同士は繋いでいない**
- **それでもサーバー側に下限（日本時間4:00、`WAKE_EARLIEST_MINUTE`）を置く。** 分岐を組み忘れた
  ショートカットや、夜ふかし中に止めたリマインダーで送ると、`NotificationLog` の抑制で**その日の分を
  夜中に使い切る**
- **生成を仕掛ける前に、送れるかを確かめる**（`checkWakeSignal()`）。下限・生成中・今日の記録・
  **Pushの購読**の順。cronの経路は `usersWithSubscriptions()` で購読者に絞っているが `runFor()` の
  中には購読の確認が無いので、見ないまま走らせると、どの端末にも届かないのに利用枠を使ってその日を
  使い切る。当たった理由は応答の `message` で返す（ショートカットの「通知を表示」へそのまま流せる）
- **生成は応答の後（`after()`）。** Codexの往復は最大180秒で、ショートカットは待てない。届いたかは
  Pushで分かる
- **履歴へ差し込む時刻は、生成が終わった後に取り直す**（#261。`deliverFor()` の `savedAt`）。
  受けた時刻（`now`）のまま保存すると、生成の最大180秒のあいだに利用者が話しかけた発言より前へ
  見通しが割り込み、画面の並びも次の往復でモデルへ渡す履歴も実際の順序と食い違う。**抑制の鍵
  （`jstDayKey(now)`）と吹き出しの期限は `now` のまま**——日付と基準時刻の話で、書き込んだ時刻ではない
- **合図とcronが重なっても生成は1本**（`briefing.ts` の `inFlight`）。今日の記録は送り終えてから
  書くので、生成中の最大180秒は `NotificationLog` の抑制が効かない。PM2で1プロセスという前提は
  `compact.ts` と同じ
- **トークンは利用者ごとに1本、DBにはSHA-256だけ**（`User.wakeTokenHash`。`src/lib/wake-token.ts`）。
  本体は発行した応答にしか出ない。暗号化して再表示すると鍵のシークレットが1つ増えるので採らなかった。
  **`BRIEFING_TRIGGER_TOKEN` を使い回さない**——VPS内のcron用の値で、iPhoneへ持ち出すと全利用者ぶんを
  起動できる鍵が端末に載る
- **`wakeTokenUsedAt` は受け付けなかった回も進める。** 画面から読みたいのは「ショートカットが届いて
  いるか」で、下限より前・送信済みで断った回もそこには含まれる

## 共有トークンから認証値を取る（#403）

**`NOTICE_INGEST_TOKEN`（受ける側。aide・research-deskから届く）と `OPS_API_TOKEN`（ops-dashboardから届く）は、
issue-deckの共有トークンAPIから実行時に取る**（`src/lib/shared-token.ts`。共有トークン名は
`AIDE_BOT_NOTICE_INGEST_TOKEN` / `OPS_API_TOKEN`）。1Passwordからの複製をやめる「方式A」。

- **取れなければ従来の環境変数へフォールバックする**（`sharedTokenOrEnv()`。ただし本番では環境変数をもう配らないので、手元・移行前の環境向け）。キャッシュ10分・タイムアウト5秒・
  失敗時は古くても直前の値。`SHARED_TOKEN_API_SECRET` と `ISSUE_DECK_URL`（deploy.ymlでorganization変数
  `APP_BASE_URL` から渡す）の両方があるときだけ取りに行く
- **フォールバックは画面から見えない。** 本番のデプロイ後は、issue-deckの設定画面で各共有トークンの利用元に
  `aide-bot` が出ることを必ず確かめる（出なければsecret・変数が未登録のままフォールバックしている）。
  取れなかった回は `console.warn` にも残る
- **#570から、環境変数のフォールバックは配らない**（`deploy.yml`・マニフェストから外した）。issue-deckへ
  `AIDE_BOT_NOTICE_INGEST_TOKEN`・`OPS_API_TOKEN` が未登録だと、お知らせの受け口（`POST /api/notices`・`/api/mcp`）と
  `GET /api/ai-usage` が401で閉じる。**そのため `deploy.yml` は、何も送る前に `scripts/check-shared-tokens.sh` で2つを
  読めるか確かめ、読めなければ配布を止める**（#581。404＝未登録、401/403/503＝`SHARED_TOKEN_API_SECRET` の不一致）。
  登録そのもの（issue-deckの設定画面での登録・利用元 `aide-bot` の確認）は人の作業で、#570の手順1。
  **確認用の読み取りも利用元 `aide-bot` として記録される**。`test/check-shared-tokens.test.ts` がスタブで判定を固定する
- 値・Bearerはログに出さない。`isNoticeIngestAuthorized()` は非同期になった（呼ぶ側は `await`）

## お知らせの受け皿と、「いまの一言」（#93）

**各アプリが「利用者に知らせたいこと」を `Notice` へ積み、秘書がダッシュボードで待っている間に
1件選んで「いまの一言」に出す。** 選ぶのも文面を書くのもモデル（`src/lib/notices.ts`）。
朝の見通し（#79）と違い、材料を外部サービスへ取りに行かない——もう積まれている。

- **積む口はHTTPまたはMCP**（`POST /api/notices` / `POST /api/mcp`・共有シークレットのBearer。
  **`NOTICE_INGEST_TOKEN` 未設定なら経路ごと401**）。ChatGPTのスケジュールはMCPの3ツールから登録し、
  既存のHTTP入口と同じ `ingestNotice()`・重複排除を通す。他アプリは同じMariaDBに同居しているので
  直接INSERTさせることもできるが、それをやると**このスキーマが外部の実装に固定され**、
  列を1つ足すたびに全アプリを直すことになる。宛先は `email`（`User.email` は一意）
- **MCPの3ツールの入力に `body` は無い**（#247）。`title` / `summary` / `recommendedAction` を
  `composeBody()`（`src/app/api/mcp/route.ts`）でつないで `body`（上限500文字）にしており、
  **title は本文の先頭にも入る**ので2回数える。`parseNoticeInput()` が超過を返すと `body` を
  名指しし、呼ぶ側（ChatGPTのスケジュール）はどの項目を縮めればよいか分からず、そのお知らせは
  登録されない。**そのため `callTool()` が先に、項目名と超過した文字数つきで断る**。上限は
  `NOTICE_BODY_MAX` / `NOTICE_TITLE_MAX`（`src/lib/notice-ingest.ts`）に1か所で持ち、
  ツールの `inputSchema` の `maxLength` と説明文にも同じ値を出す。切り詰めて受け付ける形は
  採らなかった——`aide_save_daily_brief` の後半（推奨アクション等）が黙って落ちるため
- **未読が0件ならモデルを呼ばない。黙っている間の費用は0円。** これが「10分ごとに走る」を
  許容できる唯一の理由なので、候補が無くても定型文を出すような形へ変えないこと
- **黙った回（`NO_NOTICE`）も「叩いた」ものとして残す**（`lastRuns`。プロセス内のMap。
  PM2で1プロセスという前提）。残さないと次の問い合わせで
  また叩き、**いちばん起こりやすい「知らせることが無い」場面で費用が10倍になる**
- **選び直すのは10分に1回まで。ただし、まだ一度も候補に入れていない急ぎ（`URGENT`）が
  積まれた回だけ1分まで詰める。** 画面側（`use-notice-poll.ts`）は3分ごとに問い合わせるが、
  **そのほとんどはDBを引くだけで戻る**。頻度を上げてよいのはこの造りのため
- **黙った回の後は、候補が変わらないかぎり10分おきにも呼ばない**（#227。判定は `notice-schedule.ts` の
  `shouldGenerate()`）。以前は `NO_NOTICE` で黙った後も未読が1件でも残れば10分ごとに選び直しており、
  同じ候補を同じ基準で見せ直すだけなのに1回約12,600トークンを使っていた（ダッシュボードを開いている間は
  1時間に最大6回）。黙った回（`LastRun.silent`）の後は、**前回の候補に入っていなかったお知らせが増えた・
  前回から60分（`NOTICE_REFRESH_MS`）経った・時間帯（朝・昼・夜の区切り。`notice-schedule.ts` の `noticeSlot()`）が
  変わった・候補の期限が60分／15分のしきい値を越えた**のどれかが起きるまで呼ばない。
  **候補が減っただけ（期限切れ・出し終えた）では呼ばない**（減った側は前回すべて見せて黙られている）。
  **前回が何かを選んだ回は絞らない**——選ばれなかった残りは順番待ちで、まだ一度も見せていないため、
  従来どおり10分おきに進め、黙った回に当たった時点で止まる。急ぎ（1分）の割り込みは絞り込みの外。
  期限のしきい値は「越えるたびに1回」で、残り60分以内の間ずっと呼ぶ形にはしていない。
  判定は Prisma に触れない別ファイルへ出してあり、`test/notice-schedule.test.ts` が固定する
- **`resolveNotice()` は利用者ごとに同時に1本だけ走る**（#463。`inFlight`）。複数端末のポーリングが重なると、同じ候補でCodexが二重に走り2件が同時に `shownAt` を持ちうる。走っている間に来た問い合わせは同じPromiseの結果を共有する（PM2で1プロセスという前提は `lastRuns` と同じ）
- **一度出した行は二度と候補にならない**（`shownAt`）。`ingestNotice()` のupsertは
  出した行を未読へ戻さない。戻すと同じ話が何度でも吹き出しに出る
- **モデルの返答は1行目が「番号（＋`URGENT`）」、2行目が吹き出しに出す文。**
  知らない形で返ってきた回は**黙る**（`parseChoice()` が null）。無理に読み取ると、前置きの
  一文がそのまま吹き出しに出たり、番号として読めないものを0番と見なして関係の無いお知らせを
  消費したりする。生成に失敗した回は `lastRuns` にも残さず、次の問い合わせでやり直す
- **出した吹き出しは60分で引っ込める**（`NOTICE_DISPLAY_TTL_MS`）。残し続けると、朝に選ばれた
  お知らせが夜まで頭上に居座り、いま知らせている内容だと誤解される
- **開きっぱなしのタブへの錠は2つ。** 画面が見えている間だけ動かすことと、1時間触られなければ
  休むこと（`IDLE_LIMIT_MS`）。前者だけでは、サブディスプレイに置いた画面が丸一日ぶんの
  生成を回す
- **モデルを叩かない問い合わせもただではない。** `/api/*` はRoute Handlerが自分で認証するが、
  **middlewareは素通しの判定より前に必ず `auth.getUser()` を通す**（`src/lib/supabase/middleware.ts`）
  ため、問い合わせ1回ごとにSupabaseへ1往復増える。Supabaseは他アプリと共有のプロジェクトで、
  レート制限もそちらに効く。`POLL_INTERVAL_MS` を縮めるときはここを見ること
- **aide-bot自身が最初の「積む側」になっている。** 朝の見通し（#79）が通知を送った回は、
  同じ一言を `Notice` へも積む（`src/lib/briefing.ts`）。受け皿と投入口だけでは、繋いだアプリが
  積みに来るまで吹き出しは黙ったままになる。**AIDEから材料を取れる経路はここだけ**
  （aide-botはMCPクライアントを実装していない）
- **吹き出しにエラーを出さない。** 通信も生成も、失敗した回はログにだけ残していまの表示を
  続ける。状況を知らせる場所が小言で埋まると読まれなくなる（#79と同じ理由）
- 開発DBにはダミーのお知らせを入れてある（`scripts/seed-ci-db.mjs` の `NOTICE_SEEDS`）。
  **未読が0件だと吹き出しは正しく黙る**ので、空のままでは実装が効いているのか材料が無いだけ
  なのかを画面から切り分けられない。**「まだ出せない」（`showAt` が先）と「出さないまま
  期限が切れた」（`expiresInMinutes` が負）のダミーも入れてある**（#114）。この2つは
  吹き出しには一生出ないので、一覧（`/notices`）でしか見えない

### お知らせの選定をCodexへ移した（#132）

**候補から1件選んで言い直すのを、Anthropic ClaudeからCodex CLIへ移した**（チャットの#128に続く
2本目）。プロンプト（`noticeSystemPrompt()`）も返させる形も読み取り（`parseChoice()`）も変えていない。
当時は**朝の見通し（#79）だけがClaudeのまま**残った——本文の材料をすべてAIDEのMCP接続から取る
設計で、Codex側のMCPの扱いが決まる前に移すと届く通知が空になるため。扱いは#131で決まり、
**#183で移した**（下記「朝の見通しをCodexへ移した（#183）」）。

- **`noticeSystemPrompt()` は `src/lib/anthropic.ts` に置いたまま。** ファイル名に反するが、
  ここは秘書としての振る舞い（`SECRETARY_INTRO` は#226から `src/lib/persona.ts`）の置き場で、**Anthropic SDKを使うかどうかとは
  無関係**——朝の見通し・先回りの提案もここから読んでいる
- **Codexにはシステムプロンプトを別に渡す口が無い。** 体裁の指示と候補一覧を `---` で繋いだ1本のプロンプトにする（`buildNoticePrompt()`）。
  **末尾に「本文だけを返せ」の一文は足していない**——`noticeSystemPrompt()` が返させる形を
  最後まで指定しているため
- **`max_tokens` に当たる引数が無い。** `NOTICE_MAX_OUTPUT_TOKENS`（300）は消した。長さの
  歯止めはプロンプトの「40文字前後」「3行目以降は書かない」だけになっている
- **タイムアウトを付けた**（`CODEX_TIMEOUT_MS`、60秒）。この経路はダッシュボードから3分ごとに
  叩かれるので、返らなくなると詰まったリクエストが積み上がる。`runCodexExec()` は打ち切りを
  `interrupted` で返すが、**この経路に利用者からの割り込みは無い**ので、立っていれば上限に
  掛かったものとして失敗扱いにする
- **失敗（例外）と「黙った」（null）を分ける。** 例外は呼び出し元が捕まえて `lastRuns` を
  更新せずに戻る＝次の問い合わせでやり直す。**読めない形で返ってきた回はnull**——モデルは
  実際に答えており、同じ候補ですぐ叩き直しても結果は変わらないため
- **`ApiUsage` への記録は#133で戻した。** #132の時点では「定額制だから」という理由でやめたが、
  トークン量そのものは `turn.completed` から取れる。量は `/api/ai-usage`（ops-dashboard向け）で読める
  （画面の `/usage` は#634で廃止）。**金額には積まない**
- **Codexは自前の指示文を毎回前置きする。** 実測（サブPC・`codex-cli 0.152.1`）で、プロンプトを
  `"ok"` の2文字にしても入力は12,113トークンだった。お知らせ選定の実回は12,568〜12,615トークン
  （うち8,960はキャッシュ読み）で、**足しているのは自前のプロンプトぶん約500トークンだけ**。
  `--ignore-user-config` で外れるのは利用者の `~/.codex/config.toml` 側だけで、この前置きは消せない。
  **「未読が0件なら叩かない」「10分に1回まで」の歯止めは、これまでより効いている**
- **所要は3.5〜5.3秒**（同・`gpt-5.6-luna`。Claudeのときより伸びる）。待っている間、画面は
  いま出しているものをそのまま出し続けるので止まらない

### 急ぎ（`URGENT`）のお知らせをその場でPushする（#115）

**`URGENT` は受け付けているのに、届くのはダッシュボードを開いている端末の「いまの一言」だけだった。**
画面を閉じていればその用件は誰にも届かないまま `expiresAt` を過ぎる。`ingestNotice()`
（`src/lib/notices.ts`）が `priority === URGENT` を積んだ回にかぎり、その場でWeb Pushを
1本送るようにしてある。

- **文面はモデルに書かせない。** 積む側の `body` をそのまま出す。生成を挟むと#93の
  「黙っている間の費用は0円」が崩れる（「いまの一言」用の選定・言い直しとは別経路）
- **抑制は `NotificationLog` の一意制約 `(userId, kind, dedupeKey)` に任せる。**
  `dedupeKey` には `Notice.id` をそのまま使う。`ingestNotice()` は同じ `(source, kind,
  dedupeKey)` を上書き（「あと30分」→「あと8分」）する設計だが、upsertでも `Notice.id` は
  変わらないため、同じ用件が積み直されても2回目以降は一意制約に触れてPushが飛ばない。
  Issue本文の提案どおり `<source>:<kind>:<dedupeKey>` を連結する形だと、`Notice` 側の入力上限
  （source/kind各40文字・dedupeKey120文字）をそのまま繋いだ場合に
  `NotificationLog.dedupeKey`（`@db.VarChar(120)`）を超過しうるため採らなかった
- **押した先は、`Notice.url` があればそのページ（#137）。** 無い用件だけ、ダッシュボード（`/`）を開く。
  届いた文面は「今日届いた通知」（`NotificationLog`）に残る。**会話へは積まない**（#574）
- **重い処理（Push送信）の前に一意制約の有無を確かめる。** 先に
  `NotificationLog.create()` してから重い処理へ進む順にしなかったのは、同じ用件が短時間に
  何度も届く運用ではないため。ごく短い時間差での多重POSTでは二重送信のTOCTOUが残るが、
  許容している
- **1日あたりの上限は設けていない。** 同じ用件（`Notice.id`）の二重送信だけを防ぐ。
  「読まれなくなる通知」を避ける仕組み（#79）とは別枠——URGENTは元々「時間を逃すと意味が
  無くなる」用件に限られる前提のため
- **`showAt` / `expiresAt` は吹き出し側（`pendingNotices()`）と同じ条件で絞る。**
  積んだ時点では**まだ早い**（`showAt` が先）・**もう意味が無い**（`expiresAt` を過ぎた）
  URGENTも、絞らなければそのままPushしてしまう。**`showAt` の到来だけを拾って後から送る
  仕組みは無い。** まだ早い分は積んだ回に見送られ、次に同じ用件が積み直されて
  `ingestNotice()` が呼ばれ直したときに改めて判定する
- **開発DBのシード（`scripts/seed-ci-db.mjs`）はこの経路を通らない。** `NOTICE_SEEDS` は
  `ingestNotice()` ではなく `db.notice.upsert()` を直接呼んでおり、`pnpm db:seed:dev` の
  たびにPushが飛ぶことはない

### 積まれたお知らせの一覧（#114）

**「いまの一言」に出るのは1件だけなので、控えているものを見る場所を別に置く。** 左メニューの
「お知らせ」（`/notices`）に、いま出している一言・待っている候補・出したもの・出さないまま
期限が切れたものを並べる。**見るだけの画面で、操作は置いていない。**

- **この画面は取り出すだけで、選定には一切関わらない**（`src/lib/notice-list.ts`）。
  モデルを呼ばず、`shownAt` も書かない。**書くのは `resolveNotice()` の1か所のまま**——
  一覧を開いただけで候補が消費されると、吹き出しに出るはずだったお知らせが画面を見た人にだけ
  届いて終わる
- **取り出しの条件は `src/lib/notice-conditions.ts` の1か所に閉じてある**（#229）。
  `pendingNoticeWhere()`（未読でいま出せる）・`waitingNoticeWhere()`（未読だが `showAt` がまだ先）・
  `currentNoticeWhere()`（いま吹き出しに出ている）が `Prisma.NoticeWhereInput` を返し、秘書の選定
  （`notices.ts`）・この画面（`notice-list.ts`）・左メニューの件数が
  同じ関数を通る。以前は4か所に手書きで複製していた。**条件を変えるときはこのファイルだけを直す**
  ——ずれると「一覧には出ているのに候補に入らない」お知らせができ、原因が画面側かモデル側かを
  切り分けられなくなる。**手元の1件に当てる `isWithinShowWindow()`（急ぎのPush）も同じ
  ファイル**にある。`NOTICE_DISPLAY_TTL_MS` もここ（循環importを避けるため `notices.ts` から
  移した）。Prismaは型だけをimportする純粋なモジュールで、`test/notice-conditions.test.ts` が
  条件の意味（境目・重ならないこと・JS側との一致）を固定する
- **`showAt` がまだ来ていないものは候補から外れるが、一覧には出す。** 出さないと
  「積んだはずなのに何も出ない」を画面から切り分けられない。期限切れも同じ理由で別の欄に置く
  ——**読まれずに消えたことが分かるのはここだけ**
- **`Notice.title` は後から足した列で、既定は空文字。** 積む側が省略したぶんは
  `ingestNotice()` が本文の1行目で埋めるが、列を足す前に積まれた行は空文字のまま残っている。
  画面側でも同じ埋め方をする（`toRow()`）
- **未読の件数は `(chat)/layout.tsx` で引く**ので、どの画面でも毎回1本増える。`count` 1本
  なので今月の使用量と同じ `Promise.all` に混ぜて待ち時間は足さない
- 日付・時刻は**日本時間で作る**（#79の `jstDayKey()`・#101の `jstParts()` と同じ理由）

### 押した先へ移る（#137）

**`Notice.url`（積む側が付ける元データへのリンク）を遷移先として使う。** 列もMCPの入力も#93から
あったが、`prisma/schema.prisma` のコメントどおり「記録するだけで画面からは使わない」まま
だった。使うのは3か所——急ぎのお知らせのPush（#115）・ダッシュボードの「いまの一言」・一覧（`/notices`）。

- **判定は `safeNoticeUrl()`（`src/lib/notice-url.ts`）に閉じ、受け取るときと出すときの
  両方で通す。** 受け付けるのは `http(s)://` の絶対URLと `/` で始まるパスだけで、
  `javascript:` や `//evil.example.com`（プロトコル相対）は落とす。**`/\evil.example.com` も
  同じ扱いにする**——Chromeはバックスラッシュをスラッシュとして読む。積む口
  （`parseNoticeInput()`）だけで弾かないのは、列を足す前・判定を足す前に積まれた行が
  DBに残っているため。このモジュールはクライアントコンポーネントからimportするので、
  Prismaや `next/headers` に触れるものを持ち込まない
- **`public/sw.js` に同じ判定を二重に持っている**（`safeTarget()`）。ビルドを通らない素のJSで
  importできないため。**片方だけ直さないこと**——判定を直したら `test/cases.ts` の表へ入力を足す
  （`pnpm test:unit` が3か所に同じ表を流す。#248）
- **`WindowClient.navigate()` は同一オリジンのURLしか受け付けない。** 別オリジンを渡すと
  拒否されて**何も起きない**（通知を押しても画面が変わらない）。`notificationclick` では
  `new URL(target, self.location.origin).origin` で見て、別オリジンなら開いているタブを
  探さずに `openWindow()` する。したがって `PushPayload.url` は**同一オリジンの相対パスとは
  限らなくなった**（`src/lib/push/subscriptions.ts` のコメント）
- **外部のリンクは新しいタブ、アプリ内のパスは `next/link` で同じタブ**（`isExternalNoticeUrl()`)。
  絶対URLは同じオリジンを指していても「外」として扱う——サーバー・Service Worker・ブラウザで
  「自分のオリジン」の見え方が揃わない（本番・localhost・tailnetのホスト名）
- **「いまの一言」は丸ごとリンクにしない。** 面全体が押せると読んでいる途中の誤タップになる。押せるのは末尾の「開く」だけ
- **一覧では見出しと「開く」を1つのリンクにまとめる**（`notices-view.tsx` の `Title`）。
  2つに割ると、読み上げソフトには同じ行き先のリンクが2つ並んで聞こえる
- **開発DBのシードには、リンク有り（外部・アプリ内）とリンク無しの両方を入れてある**
  （`scripts/seed-ci-db.mjs`）。**リンク無しの行を残すのが要点**——全部にリンクがあると、
  出し分けているのか全件に出しているのかを画面から切り分けられない。アプリ内を指すぶんは
  `/`（ダッシュボード）で固定。実際の経路（`src/lib/briefing.ts` の `ingestNotice()`）と同じ値にしてある

## APIの消費量（#51）

モデルを1回呼ぶごとにトークン数を `ApiUsage` の1行として残す。**利用者向けの「使用量」画面（`/usage`）と
左メニューの今月の数字は#634で廃止した**（`/usage` は404）。集計・単価計算・整形コードも消えており、
残っているのは記録の書き込み（`recordApiUsage()`）と外へ返す集計（`aiUsageGroups()`。次の節）だけ。

**このテーブルには移行前のAnthropic（従量課金）の記録が残っている**が、#183以降に積まれるのはCodex
（ChatGPTのサブスク定額）だけ。外へ返す側（`/api/ai-usage`）は実際に呼んだモデル名のまま返す。

- **Codexぶんを記録するのは「量は取れるから」。** `codex exec --json` の `turn.completed` に
  `usage` が載る（#133で実測。`src/lib/codex.ts`）。取れないのは利用枠（5時間ローリング・
  週次）の消費率だけで、トークン量は取れる
- **`input_tokens` はAnthropicと意味が逆で、キャッシュ分を含む総量。** `ApiUsage.inputTokens`
  （キャッシュに載らなかった残り）へ入れるときは引き算する（`addUsage()`）。素直に入れると、
  入力ぶんを二重に数える
- **`turn.completed` が届かなかった回（中断・起動失敗）は行を作らない**（`recordApiUsage()` が
  全部0の回を落とす）。0として残すと「呼んだのに一切消費しなかった」記録になり、回数だけが
  実態より多く見える
- **数える単位は「API呼び出し1回」。** 生成に失敗した回では行そのものが作られず、入力ぶんは使い終わっていても
  取りこぼしうるが、推定では埋めない
- **途中で打ち切られた回では、そこまでの消費量が分からない。** Codexは `turn.completed` が
  届いた回にしか `usage` を載せないので、**行そのものを作らない**（推定で埋めない）
- **使用量の記録に失敗しても本筋は止めない。** `ApiUsage` の書き込みは独立したtry/catchに置き、
  失敗はログにだけ残す（記録できないことより、通知が届かないことの方が重い）
- **Codexを呼ぶ経路は `src/lib/codex-run.ts` を通す**（#229）。朝の見通し・先回りの提案・
  お知らせの選定・話題は `runCodexRecorded()` が「呼ぶ → 使用量を残す →
  打ち切り・失敗を投げる」までを行う。違いは引数（`feature`・`label`・`model`・`timeoutMs`）と、
  投げられたものをどう扱うかだけで、後者は呼び出し側に残してある（お知らせ選定は `lastRuns` を更新せず戻り、
  朝の見通しはその日の記録を残さない）。
  **使用量は失敗より先に残す**（読めない形で返ってきた回も量は使い終わっている）。**新しい経路を
  足すときは `runCodexExec()` を直接呼ばず、ここを通す**——記録の書き忘れを塞ぐ。
  打ち切り・失敗の判定（`throwIfCodexFailed()`）はDBに触れない純粋な関数で `codex.ts` にあり、
  `test/codex-failure.test.ts` が文言を固定する（ログにそのまま出る）。**プロンプトの文面は
  この関数の外で組み立てて渡す**——1文字でも変わるとCodexのキャッシュが一度外れる
- **`inputTokens` はキャッシュに載らなかった残りだけを指す**（#56）。入力ぶんの合計は
  `inputTokens + cacheReadTokens + cacheWriteTokens`
- **`src/lib/usage.ts` はサーバー専用。** Prismaを引き込むため、クライアントコンポーネントから
  importしない
- **利用枠の残量は出せない。** `codex exec --json` にも `codex doctor --json` にも消費率は載らず、
  非対話で取る口が無い（`codex-cli 0.151.0` / `0.152.1` で確認）。**Codex CLIを上げたときはここを見直す**

## 使用量を外へ返す（ops-dashboard向け。#297）

ops-dashboardの「アプリ別のAI利用」（ops-dashboard#325）が、`GET /api/ai-usage` を読みにくる。
`ApiUsage` を**機能×モデル**に畳み、直近24時間・7日間の回数とトークン数だけを返す
（`src/app/api/ai-usage/route.ts`・組み立ては `src/lib/ai-usage-report.ts`・DBの取り出しは
`aiUsageGroups()`（`src/lib/usage.ts`））。**応答の形の正はops-dashboardの
`src/lib/ai-app-usage/parse.ts`（README「アプリ別のAI利用」）で、1行でも形が違えば応答全体が
「取得不可」になる。** 形や項目を変えるときは向こうの検証を先に読む。

- **認証は `Authorization: Bearer <OPS_API_TOKEN>`。** ops-dashboardの同名の値と同じで、**値の正は
  向こう**（`op://apps/ops-dashboard/ops-api-token`。issue-deckも同じアイテムを参照する）。
  未設定なら**経路ごと401で閉じる**（`hasValidBearer()`。`src/lib/bearer-auth.ts`）。未設定と値の違いは
  区別して返さない——他アプリの読み取り口には503で分けるものがあるが、このアプリは `/api/briefing` と
  同じく設定状況を外へ見せない。ログイン判定は挟まない（`/api/*` はmiddlewareが素通しにする）
- **機能はモデル名からは決められないので、`ApiUsage.feature` 列に持つ**（`UsageFeature`。
  `src/lib/usage-feature.ts`）。モデルは設定の画面から選べるので、お知らせの選定・話題（Luna）、朝の見通し（Astra）が
  **同じ名前の別の機能として現れる**。移行前の `chat`・`compact`・`home_profile`・`memory` は名前だけ残している。
  **`recordApiUsage()` は `feature` を必須にしてある**ので、機能を足して渡し忘れると型で落ちる。
  機能を足したら `USAGE_FEATURE_LABELS` へ名前を足す（この名前がops-dashboardの画面にそのまま出る）
- **列を足す前の行は `feature` が空文字のまま**（マイグレーションでは推測しない）。空文字と表に無い値は
  1つの「その他（機能の記録なし）」へ足す——捨てると合計が黙って少なくなる。集計の窓は最長7日なので、
  デプロイの1週間後にはこの行は消える
- **`inputTokens` はキャッシュに載らなかった分だけ**（`ApiUsage.inputTokens` そのまま）。画面の使用量
  （`promptTokens()`）はキャッシュ込みの合計だが、**こちらで足して返さない**——ops-dashboardが自分で
  キャッシュ分を足すので二重に数える。`cacheReadTokens` / `cacheWriteTokens` も別の項目で返す
- **返すモデル名は実際に呼んだものそのまま**（`gpt-5.6-sol` など。移行前の記録は `claude-haiku-4-5`）。
  ops-dashboardの単価表（`models.ts`）にはGPT-5.6系が無く、**金額は「不明」と出る**（近いモデルで推測しない
  のが向こうの方針）。定額（Codex）なので実害は無いが、金額を出したければ向こうの表へ足す
- **全利用者ぶんの合計で、`userId` では絞らない。** 呼び出し元は利用者を持たない外部サービスで、知りたいのは
  「このアプリがどれだけ使ったか」。返すのは回数とトークン数だけで、プロンプト本文・返答・利用者の情報は
  含めない
- **24時間→7日間の順に別々のクエリで引く**（同じ `now` から境目を作る）。逆にすると、2本のあいだに積まれた行が
  24時間には入って7日間には入らず、7日間が24時間を下回る。組み立て側（`buildAiUsageReport()`）にも、
  下回ったら24時間へ揃える保険を置いてある
- **呼び出しが無い期間は `features: []`**（エラーにしない）。24時間に呼び出しが無い行は0で埋める
  （向こうは両方の期間を必須にしている）
- **ops-dashboardの `AI_APP_USAGE_SOURCES` へ足すのは向こうの設定**（`{"app":"aide-bot","url":"…/api/ai-usage"}`）。
  同じVPSなら `http://127.0.0.1:3103/api/ai-usage` でよい（向こうはhttpsか同一ホストのループバックだけ許す）。
  手元では `.env.local` に `OPS_API_TOKEN` を入れて `curl -H "Authorization: Bearer …"` で確かめる。
  開発DBのシード（`scripts/seed-ci-db.mjs`）は機能ごとの記録を入れてある
- テストは `test/ai-usage-report.test.ts`。**ops-dashboardの検証規則を写した関数**で、組み立てた応答が
  受け付けられることを確かめている（向こうの規則が変わったらここも直す）

## 話題——ニュースを仕入れてダッシュボードに出す（#144）

ニュースを `codex --search exec`（ChatGPTのサブスク枠。APIキーも依存も増えない）で仕入れて `Topic` に溜め、
ダッシュボードの「話題」・話題の画面（`/topics`）・定時のお知らせ・朝のニュースに使う（`src/lib/topics.ts`）。
#574で、相談の材料・待機中の吹き出しの輪・秘書からの声かけは無くなった。
**溜め先は `Notice` と分ける。** あちらは「逃すと困るか」で1件選ぶ受け皿で、ニュースを混ぜると
用件が候補から押し出される。

- **出すときはモデルを呼ばない。** `Topic.lead`（秘書の一言）は仕入れたときに一度だけ書かせた文。
  #93の「黙っている間の費用は0円」はそのまま
- **仕入れの起点はアプリを開いたとき（ダッシュボードの問い合わせ）と、定時のお知らせの直前（#362）。仕入れ専用のcronは足さない。**
  `/api/notices/current` が応答を返した後（`after()`）に `refreshTopicsIfStale()` を呼び、前回から1時間
  （失敗後は15分）あいていればバックグラウンドで1回走る。定時のお知らせの直前の仕入れは下記
  「定時のお知らせ（#344）」の節。それ以外に、開いていないときへ仕入れを足さない。
  前回の時刻はプロセス内のMap（`attempts`）に成否を問わず残し、再起動直後だけDBの `fetchedAt`
  を見る——DBだけだと0件・失敗の回で時刻が進まず、3分ごとの問い合わせのたびに仕入れ直す。
  **「走っている」印（`running`）は、同期の判定を通った直後、DBを見る前に立てる**（#263）。
  DBを2回待った後に立てると、その窓に別の端末の問い合わせが重なって二重に仕入れる（1回が約38万
  トークン）。DBを見て走らせないと決まった回（種類が0件・DB上は仕入れたばかり・前処理の失敗）は
  印を前回の記録へ戻す。朝の見通しの `inFlight` と同じ形
- **`--search` は `exec` のサブコマンドではなく `codex` 本体の引数。** `codex exec --help` には
  出ず、`codex --help` にだけ出る。`spawn` の引数は `["--search", "exec", ...]` の順
  （`runCodexExec({ search: true })`）。読み取り専用のサンドボックスと両立する
- **`--search` 付きでは「調べます」の一言が別の `agent_message` として先に届く**（実測）。
  `CodexResult.text` はそれも連結するので、形を決めて読み取る経路は `messages` の最後の1件を読む。
  JSONLには `web_search` の `item.started` / `item.completed` も混ざる（`id` キーが重複した行だが
  `JSON.parse` は通る）
- **1回が重い。** 実測（`gpt-5.6-luna`・2026-09-02）で、3件を頼む短いプロンプトでは27秒・入力64,086
  トークン（うち29,952がキャッシュ読み）、本番の形（3種類×2件）では入力の総量が約38万トークン
  （うち約32万がキャッシュ読み・残り61,364）・出力2,727——検索を重ねた回はその分だけ
  `turn.completed` の `usage` が積み上がる。お知らせ選定の1回の数十倍。間隔を縮めるときはサブスクの
  利用枠の減りを見る。トークン量は `ApiUsage` へ残す（用途「話題の仕入れ」のモデル。金額は付かない）
- **返答はJSON配列で受け、壊れた要素だけ落とす**（`parseTopics()`）。URLは `safeNoticeUrl()` を通した
  絶対URLだけ。読める記事が0件の回は失敗にしない（同じ検索をすぐ叩き直しても変わらない）
- **仕入れる種類は利用者が追加・編集・削除できる**（#345。`TopicCategory`。上限8件）。
  「話題」ページ（`/topics`）の上段で管理する。設定ページに置かないのは、仕入れた結果のすぐ上に
  ある方が効果が見えるため。**初期の3種類（`general`/`life`/`tech`）は初回の読み出しで投入する**
  （`topic-category-store.ts` の `ensureInitialized()`。`User.topicCategoriesReady` のCAS。
  移行元の `User.topicCategories` はこの初回にだけ読んでオン・オフを引き継ぐ）。**全部をオフ・
  全部を削除した状態は「仕入れない」**（初期値へ戻さない）。`Topic.category` には種類の `key` を
  入れ、**外部キーにしない**——削除しても仕入れ済みの記事は残り、チップは「その他」になる。
  **「集める内容」（`scope`）はプロンプトへそのまま入る**ので、`validateTopicCategoryInput()` が
  改行・制御文字を畳み長さ（200字）を制限する。型・検証は `src/lib/topic-categories.ts`
  （クライアントからもimportするのでPrismaを持ち込まない）、DBは `topic-category-store.ts`
- **説明文の「試しに検索」**（`POST /api/settings/topics/preview`）は、その1種類だけを仕入れと同じ
  プロンプトで検索して記事を返す。**何も保存しない**。サブスク枠を1回ぶん使い20〜30秒かかるので、
  利用者ごとに同時実行は1つ・終わってから1分あける（プロセス内の記録。`maxDuration` は180秒）。未保存の種類には `key` が無いので仮のid（`preview`）でプロンプトと `parseTopics()` を通す
- 開発DBのシード（`scripts/seed-ci-db.mjs` の `TOPIC_SEEDS`）は実際の検索を走らせない。
  **期間（24時間）を過ぎた行を1件入れてある**——一覧にもダッシュボードにも出ないことを確かめるため。
  実際の仕入れを手元で通すには、`Topic.fetchedAt` を2時間ほど戻してから `/api/notices/current` を
  叩き、30〜60秒待って `Topic` を見る

## 定時のお知らせ（#344）

**曜日・時刻（30分刻み）・話題の種類を指定して、溜めてある話題（`Topic`。#144）の見出しを定時にWeb Pushで届ける。**

- **`ScheduledPush.category` は `all` か話題の種類の `key`（#345）。** 種類は追加・削除できるので形は固定せず、
  受け付けるときに利用者の種類と突き合わせる（`scheduled-push` のRoute Handler）。**削除された種類を指した行は残り**、
  設定の画面では「（削除された種類）」と出る（記事は残っているので届く。件名のチップは「その他」）
判定は `src/lib/scheduled-push-rule.ts`（純粋。`test/scheduled-push-rule.test.ts`）、実行は `src/lib/scheduled-push.ts`。

- **起点は朝の見通しと同じcron**（`/api/briefing` の末尾で `after()`）。crontabの変更は要らない。**モデルは呼ばない**
  （費用0円）。話題が0件の回は黙り、記録も残さない
- **送るのは「予定の時刻を過ぎた最初の起動」で、猶予は3時間**（`LATE_LIMIT_MINUTES`）。登録・変更より前の時刻の分は
  送らない（`createdAt` と比べる。曜日・時刻を変えたら `createdAt` を取り直す）
- **同じ日・同じ設定で二度送らない**: `NotificationLog`（kind=`scheduled-push`、`dedupeKey`=`<日付>:<設定id>`）。
  朝の見通し・急ぎ・先回りの提案の枠は消費しない
- **送る前にニュースを仕入れる**（#362。`refreshTopicsForSchedule()`）。送信対象で未送信の設定があるときだけ、
  `startRefresh()`（アプリを開いたときの仕入れと同じ入口・同じ `attempts` の錠）を最小間隔30分で呼ぶ
  （`runScheduledPushes()` の先頭で、送信対象の利用者ごとに1回）。
  仕入れ済み・失敗・実行中でも止めず、溜まっている話題で送る。**仕入れの起点は「アプリを開いたとき」だけでは
  なくなった**（cron経由でも走る）が、1回約30秒〜数分・サブスク枠を使う点は#144のまま
- **同じ出来事は1件にまとめる**（#362。`src/lib/topic-dedupe.ts`。純粋関数・`test/topic-dedupe.test.ts`）。
  見出し＋要点の文字2つ組のDice係数（`DUPLICATE_THRESHOLD`＝0.5）で判定し、**表示のときだけ**まとめる
  （DBの行は消さない。モデルは呼ばない）。比べる相手は各グループの代表だけ（連鎖で別件を引き込まない）。
  話題画面・ダッシュボード・左メニューの件数・定時のお知らせが同じ関数を通る。定時のお知らせは
  グループの1件でも `spokenAt` があれば出さず、送ったらグループ全体に `spokenAt` を付ける。
  誤ってまとめるより、まとめ損ねる側へ倒してある——閾値を下げるときは別件の誤統合をテストで確かめること
- **押した先は `/topics`。**
- **設定の置き場は話題の画面（`/topics`）の「通知する時間」**（#418。以前は設定画面）。設定画面には案内リンクだけを残してある。
  カード本体は `ScheduledPushSettingsCard` のまま。通知の判定・送信は変えていない。**初期表示は閉じている**（#427。ニュースを先に読めるように。開閉は保存しない）
- **話題の画面は取り込み回ごとに区切り、未読の境目に線を引く**（#418。`src/lib/topic-timeline.ts`。純粋・`test/topic-timeline.test.ts`）。
  **並びも回の区切りも `Topic.createdAt`（初めて取り込んだ時刻）**で作る。`fetchedAt` は仕入れ直しで進むので、使うと既読の記事が
  新しい回へ移って「ここまで未読」の線が1本で引けない。`createdAt` は行ごとのinsertでずれるので、隣り合う記事が2分以内なら同じ回。
  未読は `createdAt > User.topicsSeenAt`。**「通知で届けた」の印は出さない**（`spokenAt` は朝のニュース・定時のどちらでも付く）
- **`topicsSeenAt` を書くのは画面が開いたときの `POST /api/topics/seen` の1回だけ**（`TopicSeenMarker`）。ページの描画（`after()`）で書くと、
  同じ画面の `router.refresh()`（種類の追加など）で境目が消える。**送るのは描いた時刻**で、サーバーは現在時刻に丸め、古い値では巻き戻さない。
  画面側の基準（`seenAt`）は `TopicTabs` が初回のpropsを `useState` に固定する。初回（null）は全件を既読として出す。
  `recentTopics()`（ダッシュボードなどと共有）の並び・期間は変えていない（並べ替えは `buildTimeline()` の中だけ）
- 1人8件まで（`SCHEDULED_PUSH_LIMIT`）。設定は `ScheduledPush` テーブル（cronが読むのでCookieにしない）。
  送った話題には `Topic.spokenAt` を付け、次の定時は選ばない（未送信の新しい順3件）
- **定時の前の仕入れは#362で入れた**（上の「送る前にニュースを仕入れる」）。以前はアプリを開いたときだけで、
  24時間開いていない日は話題が無く黙っていた。**仕入れは配信のループの外で、利用者ごとに1回・並行して待つ**
  （ループの中で待つと最大150秒のあいだ後ろの設定の配信が止まる）。時刻より前のcronで仕入れる案は、猶予内で
  仕入れの古さが読めなくなるため採らなかった。声かけ（#278）も同じ統合を通り、まとめた記事のどれかを振ったら
  グループ全体に `spokenAt` を付ける（`unspokenGroups()`。定時で送った出来事の別媒体の記事を後から振らない）

## 接続の「できること」一覧（設定の接続一覧。#167）

**「部屋の温度は取れるのに天気は場所を聞かれる」が何なのか画面から分からない**、というのが
#167の出発点。接続ごとの「聞けること（`provides`）／まだ取れないこと（`missing`）」を
`MCP_PRESETS`（`src/lib/mcp/presets.ts`）に持ち、設定の画面の接続の行へ並べる。

- **手で保つ一覧で、接続先の道具そのものではない。** `tools/list` を引いて出しているわけでは
  ないので、AIDE側が道具を増減したらここも直す
- **プリセットに無い接続（利用者が自分でURLを入れたもの）では何も出さない。** 把握していない
  ものを「できること」として並べると、繋げば何でも聞けるように読める
- 天気は `aide_weather` が**今日と明日・自宅の地域ぶんだけ**返す。交通は未実装
  （`guchi-apps/aide#33`）。この2つが「聞くと場所を聞かれる」の実際の中身

## 先回りの提案（#325）

**開いていないときに、秘書の方から「今ならできる」「そろそろ対応したい」をWeb Pushで伝える。**
材料はNotionの「いつかやりたいこと」（#324）・AIDEの予定と空き時間・未完了の用件。
判定は `src/lib/proactive-rule.ts`（純粋）、実行は `src/lib/proactive.ts`。

- **起点は朝の見通しと同じcron。** `/api/briefing` の応答後（`after()`）に走らせる。新しい
  エンドポイントもVPSのcrontabの変更も要らない。30分ごとに叩かれても、モデルを呼ぶのは
  `proactiveGate()` を通った回だけ（1回がCodex＋MCPで朝の見通しと同程度に重い）
- **モデルを呼ぶ前にDBの値だけで弾く**: 種類オフ・静かな時間帯・平日の勤務帯（8〜19時。祝日は
  見ない）・1日1件／週の上限・前回の判定から30分（`User.proactiveCheckedAt`。送った・黙った・
  失敗のどれでも進める）。NotionとAIDEの両方が繋がっていなければ呼ばない
- **種類は3つ**（`weekend`＝金曜・土曜だけ／`free_time`／`ongoing`）。種類・静音・頻度は設定の画面
  （`User.proactive*`。cronが読むのでCookieにしない）。
- **取得失敗を「何もない」と解釈しない。** プロンプトで `NO_SUGGESTION` を返させ、返答の形が
  読めない・オフの種類の返答は `parseProactiveReply()` が黙らせる。生成に失敗した回は何も送らず記録も残さない
- **重複抑制**: `NotificationLog`（kind=`proactive-suggestion`）の `dedupeKey`＝週:種類:候補名:予定状態のハッシュ。
  同じ週の同じ候補・同じ予定状態は一意制約で止まり、予定や候補が変われば鍵が変わって再判定される。
  **候補名は鍵の中に読める形で残し、14日以内に伝えた候補は次の判定のプロンプトへ渡して繰り返させない**
- **書き込みの道具は常に止める**（`toCodexMcpServers(servers, false)`）。押した先はダッシュボード（`/`）で、
  通知の本文を読むだけ（会話へは積まない。#574）
- **急ぎ（#115）・朝の見通し（#79）とは別の `kind`。** その枠を消費しないし、急ぎはこの上限・静音の対象外
- **実データでの提案の質は未確認**（Notionの実スキーマを実物で見ていない。#323と同じ）。手元では
  `CODEX_BIN` のスタブで配線（プロンプト・返答の読み取り・記録）を確かめる

### 実機（iPhoneのPWA）で開発環境を試す（#205）

**#155・#164・#179・#197で追ってきた症状は、iPhoneのホーム画面PWAでしか再現しない。** それを
本番へデプロイしてからでないと試せなかったので、開発環境をそのまま実機のPWAとして開けるように
してある。

```bash
pnpm dev          # 別のシェルで起こしておく
pnpm dev:https    # tailnetへHTTPSで公開し、iPhoneで開くURLを出す
```

- **HTTPSでないと何も確かめられない。** マイク（`getUserMedia`）もWeb Speech APIも
  secure context 限定で、ホーム画面への追加（standalone）もHTTPSでないとできない。無人実行の
  ランチャーが張る `http://<ホスト>.ts.net:<ポート>` では**画面は出るのにマイクが開かない**
- **HTTPSのポートは開発サーバーのポート＋10000にしてある**（`scripts/dev-https.sh`）。同じポートへ
  張ると、tailscaledと `next dev` がポートを取り合って `EADDRINUSE` で開発サーバーが起動しなく
  なる（実測）。issueごとに割り当てられる24xxx番台とも重ならない。**443は他のアプリがすでに
  使っている**ので、ポートを明示せずに張らないこと
- ログインは `/login` の「開発用ダミーユーザーでログイン」から。`pnpm db:seed:dev` を先に流す
- **返答は `CODEX_BIN` をスタブ（`scripts/codex-stub.sh`）へ差し替えて返させる。** 実物のCodexは
  1往復に数十秒かかりサブスクの利用枠を消費するので、聞き取りの開き直しのように何度も繰り返す
  検証には向かない。**`.env.local` へ書くこと**——コマンドラインで前置きしても効かない（#183）
- **`.env.local` のSupabaseの値を空にしない**（#121）。middlewareが全リクエストを500にする。
  `.env.local.example` の既定はCIと同じダミー値で、開発用ログインだけならこれで通る

## 通知の種類ごとのオン・オフとテスト送信（#488）

**端末の登録（Web Push購読・APNs）とは別に、利用者単位で「どの種類の通知を受け取るか」を持つ。**
種類は5つ（朝の見通し・朝のニュース・急ぎのお知らせ・先回りの提案・定時のお知らせ）で、定義の正は
`src/lib/push/kinds.ts`（`NotificationLog.kind` と同じキー。クライアントからもimportする）。

- **保存は `User.pushDisabledKinds`（オフにした種類のキーをカンマ区切り。空文字＝全部オン）。** 種類ごとに列を
  足さないのは、種類が増えるたびにマイグレーションが要るため。**知らない名前は `parseDisabledKinds()` が捨てる**。
  読み出しは `disabledPushKinds()`（`kinds-server.ts`）で、読めなかった回は全部オンへ倒す（通知を黙って止めない）
- **止める場所は送信の手前ではなく生成の手前。** 朝の見通しは `deliverFor()` の先頭（モデルを呼ばない）、先回りの提案は
  `runProactiveSuggestions()` の判定の前、定時のお知らせは仕入れの前、急ぎのお知らせは `notifyUrgentNotice()`
  （「いまの一言」・一覧には出る。Pushだけを止める。オフの間に積まれた用件は、オンに戻しても遡って送らない）。
  **朝の見通しだけオフ・朝のニュースだけオンの場合**は `deliverTopicsOnly()` がニュースだけを届ける（ニュースの
  `NotificationLog` で1日1本を守る）。**新しい通知の種類を足すときは `PUSH_KINDS`・`PUSH_KIND_INFO` と、生成の手前の止め処を揃える**
- **「試しに送る」は種類別**（`POST /api/push/test` の `{ kind }`。本文なしは従来の1本）。その種類と同じタイトル・遷移先の
  見本を送り、**種類がオフでも送れる**（確かめたいのは届き方）。モデルは通さない（費用0円）
- 先回りの提案は、種類ごとの設定（週末・空き時間・用件）の上位に、この全体スイッチがある。会話からの提案（#324）には効かない
- 画面は設定の「通知の種類」（`PushKindsCard`）。保存は `PATCH /api/settings/push-kinds`（`{ "<種類>": true|false }`）

## 外部サービスとの接続（MCP）

朝の見通し・先回りの提案でAIDEやNotionのデータを引けるようにする仕組み（#46。相談で使うのは#574で廃止）。**MCPクライアントは
実装していない。** 繋ぐのも道具を実行するのもモデルの提供元側——**#183からはどの経路もCodex CLI**
（朝の見通し・先回りの提案）が、リモートMCPサーバーへ繋ぐ。aide-botが持つのは
「どこへ・どの資格情報で繋ぐか」だけ（`src/lib/mcp/`・`prisma` の `McpConnection`）。
認可（OAuth・トークンの更新）はどの経路も同じ `listConnectedServers()` を通る。

**#131でCodexから繋ぐ形にした。** やり方は下記
「Codexから繋ぐ（#131）」。**Messages API固有の記述（`mcp_toolset`・ベータ指定・`max_tokens`・
`pause_turn`）は#183で当てはまる経路が無くなったので消してある**——必要になったらgitの履歴から
拾うこと。

### Codexから繋ぐ（#131）

`/api/chat` は接続を `toCodexMcpServers()` で均し、`runCodexExec()` が `-c mcp_servers.<slug>.url=…` と
`bearer_token_env_var` で1回ごとに渡す（`src/lib/codex.ts`。**`--ignore-user-config` は
`~/.codex/config.toml` を読まないだけで、`-c` の明示オーバーライドは独立に効く**）。
実測はサブPC・`codex-cli 0.152.1`・2026-09-05。

- **`default_tools_approval_mode="approve"` が無いと道具を呼べない。** 非対話の `exec` は承認
  ポリシーが `never` で、呼び出しが「MCP tool call requires approval, but approval policy is
  never」で失敗する。付ければ承認なしで通る
- **道具ごとの絞り込みは `disabled_tools=[…]` でできる。** Issue #131のコメント（#151の調査）に
  「道具ごとのenabled/disabledが無い」とあるのは見落としで、バイナリの設定キーに `enabled_tools` /
  `disabled_tools` がある。名指しした道具は `tools/list` の結果から落とされ、モデルには見えず
  `tools/call` も飛ばない（スタブMCPへの実測で0回）。#78の絞り込み（`MCP_PRESETS` の
  `writeTools`）はこれで再び効く——**挙げ漏らした道具はそのまま渡る**のは同じ
- **`features.apps=false` を全 `codex exec` に付ける**（接続の有無によらず）。付けないと、利用者の
  ChatGPTアカウントに繋いであるコネクタが `codex_apps` というMCPサーバーとして勝手に混ざり、
  **AIDEの全道具（`aide_zaim_payment` を含む）がどの経路のモデルにも見える。** 承認ポリシーで
  止まってはいたが、モデルがそちらを試して往復を無駄にする。`-c mcp_servers.codex_apps.enabled=false`
  は「invalid transport」で起動ごと落ちる
- **接続を付けるだけなら待ち時間は伸びない**（`gpt-5.6-luna`。付けない3.4〜4.0秒／付けて3.5〜3.9秒。
  `initialize`＋`tools/list` は同じ回の中で済む）。**伸びるのは道具を実際に呼んだ回だけ**（＋約9秒＝
  モデルがもう1回考えるぶん）。`supports_parallel_tool_calls=true` で複数の道具を1回にまとめさせ、
  システムプロンプトで「会話にある情報や事実を要しない話では呼ばない」と釘を刺してある
  （`connectedServiceRules()`）
- **落ちている接続先があっても相談は止まらない**（`startup_timeout_sec`。実測3.9秒で通常の返答）。
  `tool_timeout_sec` も付けてあり、返らない道具で往復ごと固まらない
- **道具の呼び出しはJSONLの `item.started` / `item.completed`（`item.type === "mcp_tool_call"`）で届く。**
  `server`（＝slug）・`tool`・`arguments`・`result.content[].text`・`error.message`・`status` が載る。
  引数は始まりの時点で丸ごと届く（Anthropicの `input_json_delta` のような刻みは無い）。
  `/api/chat` はこれで「いま調べています」（SSEの `tool`）と書き込みの記録（#81。`ToolCall`・
  SSEの `record`）を組み立てる。**本文は完了時にしか届かない**ので、生成中に画面へ出せるのはこれだけ
- **道具を呼ぶ前に「確認します」の前置きが別の `agent_message` として先に届く**（`--search` と同じ形）。
  `CodexResult.reply` は最後の道具より後ろの本文だけを繋ぐ。`text`（全部の連結）を返答にすると
  道具の名前が本文に出る・読み上げが前置きから始まる
- **アクセストークンは子プロセスの環境変数（`AIDE_BOT_MCP_TOKEN_<SLUG>`）で渡す。** 引数に載せると
  `ps` や起動ログに出る。`--ephemeral` なのでセッションのログにも残らない
- **手元で確かめるときは、`CODEX_BIN` を偽のスクリプトに差し替える経路と、実Codex＋ローカルの
  スタブMCPサーバー（httpのlocalhostで繋がる）の2つを使い分ける。** 前者は `-c` の引数・環境変数・
  記録の配線を、後者はCodex側の実際の振る舞い（承認・絞り込み・イベントの形）を確かめる。
  スタブのURLは `MCP_PRESETS` に無いので、絞り込みと記録は前者でしか通らない
- **繋ぎ先は「公式のリモートMCPサーバーがあるものは直接、無いものはAIDE経由」で分ける。**
  Googleカレンダー・GmailはClaudeアプリ側のコネクタで、APIから叩ける公開URLが存在しない。
  この手のサービスはAIDE（`guchi-apps/aide`）へコネクタとツールを足し、AIDEの1接続にまとめる。
  逆にNotionのように公式のリモートMCPがあるものをAIDEへ載せてはいけない
  （AIDEの「公式MCPと重複するツールをMCP層に出さない」方針とぶつかる）
- **保存するのは本文だけ。** ツールの呼び出しと結果は履歴に残さないので、次の往復では
  ふつうのuser/assistantの並びに戻る。宙に浮いた `tool_use` が残らない。
  **`Message` に残さないだけで、記録そのものを捨てているわけではない**（#81。後述
  「書き込みの記録」を参照）
- **アクセストークンはDBに平文で持つ。** 同一VPS・利用者1人という前提と、接続先である
  AIDE自身が `data/auth/` に平文で持っていることに合わせた（#46で相談のうえ決定）。
  暗号化するとシークレットが1つ増え、1Passwordと本番設定の手作業が発生する
- **認可のコールバック（`/api/connections/callback`）はログイン判定を挟まない。**
  相手の認可画面を経由して戻る経路で、手掛かりは `state` だけになる。こちらが発行して
  DBへ保存した使い捨ての値なので、当たった行の利用者以外は書き換えられない
- **stateは10分で期限切れ・使い捨て**（#469。`pendingStartedAt`・`src/lib/mcp/pending-state.ts`）。`completeConnection()` は交換の前に `updateMany`（`pendingState` 一致が条件）で途中経過を消し、`count` が1の側だけが先へ進む。同時に来た片方と、期限切れ・開始時刻の無い行は断る
- **`.well-known` はパスを差し込む形と差し込まない形の両方を試す。** 仕様は
  `https://example.com/.well-known/oauth-protected-resource/mcp` と定めているが、
  パス無しでしか出していない実装がある
- **開発DBのダミー接続は、生成に渡らない状態で入れてある**（`scripts/seed-ci-db.mjs`）。
  使えるトークンを持った接続を入れると、開発環境で朝の見通しなどを動かすたび実在しない資格情報で
  外部へ繋ぎに行き、返答の生成そのものが失敗する

### 予定（カレンダー）の連携（#184）

**Googleカレンダーの予定は、AIDEの `aide_schedule`（DaySpan経由。aide#173）で本番からすでに引ける。**
aide-botはGoogleカレンダーへ直接繋がない（認可はDaySpanの1本に閉じる。上記「繋ぎ先は…」と
AIDEのREADME「認可の分離」）。#184で足したのは、その道具を秘書が正しく使えるようにする側だけ。

- **予定の登録は、DaySpan（dayspan#550）→ AIDE（aide#243）→ aide-bot（#185）の順に口が
  作られ、#185でaide-botの配線も完了した。** DaySpanの `POST /api/events` はブラウザの
  セッションでしか叩けず、サーバー間用のAPIは読み取り（`GET /api/internal/schedule`）しか
  無かったため、書き込み用に `POST /api/internal/events` を別途足した経路。**予定の変更・
  取り消しに当たる道具は無い**（`aide_create_event` は新規作成専用。`missing` に残してある）
- **#185で足した `aide_create_event` は `MCP_PRESETS` の `writeTools` に入っている**（止める側の表と同じ）
- **本番のAIDEが予定を返しているかは、Claude CodeのAIDEコネクタから `aide_schedule` を直接
  叩けば分かる**（#184でそうやって `configured: true` を確かめた）。開発DBのAIDE接続はダミーの
  トークンなので、手元で実際に予定を引くことはできない。確かめられるのはプロンプトと
  `-c mcp_servers.aide.*` の配線まで（`CODEX_BIN` の差し替え）

### 書き込みの道具（#78）

繋いだサービスの道具には、**あとから取り消せない結果が残る**ものがある
（AIDEの `aide_zaim_payment` はツールの説明文に「この経路から取り消し・修正はできない」と明記されている）。
#574で相談を廃止したので、**いまCodexへ渡す経路（朝の見通し・先回りの提案）は書き込みの道具を常に止める**
（`toCodexMcpServers(servers, false)`）。ユーザーが選べる許可設定・Cookie・設定画面の選択欄は無い。

- **止め方は `disabled_tools=[…]`**（`toCodexMcpServers()` → `runCodexExec()`。#131）。名指しした
  道具は `tools/list` の結果から落とされ、モデルには見えず `tools/call` も飛ばない
- **止める道具の名前の正は `MCP_PRESETS` の `writeTools`**（`src/lib/mcp/presets.ts`）。名指しで止める形なので、
  **挙げ漏らした道具はそのまま渡る**。接続先が書き込みの道具を増やしたら、ここへ足すまで絞り込みは効かない。
  逆向き（取得系だけを名指しで許す）にしないのは、接続先が取得系を1つ足すたびにこちらを直すまでその道具が
  使えなくなるため。**取りこぼしても壊れない側へ倒してある**ので、「絞り込んだから安全」と見なさないこと
- **朝の見通しは材料の10本だけを渡す**（`briefingTools`。#367）ので、そちらは名指しの漏れに依存しない
- **Notionの `writeTools` はあえて空にしてある。** 実在する道具名を実物で確かめられないため。Notionは
  許可リスト（`briefingTools`）を持たないので朝の見通しにも渡らない

## アイコン

- **アイコンの正は `public/icon.svg`（承認済みのMorrowのMマーク。1024×1024）。** `public/icon-192.png`・
  `public/icon-512.png`・`public/apple-icon.png`・`src/app/favicon.ico` はそこからの書き出し物で、
  `scripts/build-icons.sh`（`rsvg-convert` と ImageMagick を使う）で作り直す。
  PNGを直接編集しても、次にスクリプトを流した時点で戻る
- **maskable（`purpose: "maskable"`）だけは別SVG（`public/icon-maskable.svg`）から `icon-maskable-512.png`
  を書き出す。** Androidのアダプティブアイコンは中心から半径約410px（1024基準）の円の外を切り落とすが、
  承認図の線端の円は約440pxまで出るため、maskable用は中心から0.8倍にしてある。
  **絵を変えるときは `icon.svg` と `icon-maskable.svg` を揃える**
- 画面の中で使うアイコンは `src/components/brand/app-icon.tsx`（インラインSVG）。26px前後で置く
  場所が多いため、ファイルを `<img>` で読ませない。**絵を変えるときはSVGファイルと
  このコンポーネントの両方を揃えて直す**（角丸と薄い縁取りはコンポーネント側だけが持つ）。
  横長ロゴは同じファイルの `AppLogo`（Mマーク＋HTMLの「Morrow」。暗い背景では文字がアイボリー）
- **`app-icon.tsx` では `id` を使わない**（#49）。「書く」画面は返答1件ごとにこのアイコンを
  描くため、`url(#…)` で参照する書き方にすると、同じidが1ページに何個も出る

## バージョン表示

- **画面に出るバージョンの正は `package.json` の `version`。** 左メニュー（`ConversationRail`）の
  最下部に `v0.3.0` の形で出る。リリース時のbumpを忘れると、本番の画面に古い版が出続ける
- **`src/lib/app-version.ts` はサーバーコンポーネント専用。クライアントコンポーネントから
  importしないこと。** JSONのimportはプロパティ単位では削られず、`package.json` が丸ごと
  クライアントバンドルへ入る（実際に依存パッケージ名と `packageManager` のハッシュが
  `.next/static/chunks` に出た）。値は `src/app/(chat)/layout.tsx` で読み、
  `ChatShell` → `ConversationRail` へpropsで渡している

## 検証コマンド

```bash
pnpm lint        # ESLint
pnpm typecheck   # tsc --noEmit
pnpm test:unit   # node --test（test/**/*.test.ts）
pnpm build:ci    # prisma generate && next build
```

CI（`.github/workflows/ci.yml`）はこの4つを実行する。`pnpm test` は `lint`・`typecheck`・`test:unit` を
まとめて流す。ビルドは外部サービスへ接続しないため、`DATABASE_URL` と `NEXT_PUBLIC_SUPABASE_*` は
CI専用のプレースホルダーでよい。

### 単体テスト（`test/`。#248）

**依存は足していない。** Nodeの標準の `node --test` と、型を剥がして `.ts` を直接読む機能
（Node 22.18以降）だけで動く。`@/` の解決は `test/alias-hooks.mjs`（`--import` で登録）が受け持つ。

- **対象は「外から来た値を判定する関数」と、ずれると静かに壊れる件数の計算。** いまは
  `isInternalPath()` / `safeInternalPath()`・`safeNoticeUrl()`・`public/sw.js` の `safeTarget()`
  との一致・`readJsonObject()`（#262）・`parseNoticeInput()`
  （`notice-ingest.ts`）・`parseChoice()`（`notice-choice.ts`）・`shouldGenerate()`（`notice-schedule.ts`。お知らせ選定を呼び直す条件。#227）・`buildAiUsageReport()` /
  `hasValidBearer()`（`ai-usage-report.ts`・`bearer-auth.ts`。使用量APIの組み立てとBearer検証。#297）・
  `pendingNoticeWhere()` ほか（`notice-conditions.ts`。お知らせの未読・表示中の条件。#229）・
  `throwIfCodexFailed()`（`codex.ts`。Codexの打ち切り・失敗の文言。#229）。**PrismaやSupabaseへ触れる
  モジュールはimportしない**（テストからDBへ繋がない）。**DBに触れるモジュールの中にある計算を
  テストしたいなら、純粋な関数として別ファイルへ切り出す**（#265で `parseChoice()` を
  `notices.ts` から出した）。`@prisma/client` の `NoticePriority`
  のように、生成物を実行時にimportするだけのものは素のNodeでも読める
- **入力の表は `test/cases.ts` に1つだけ置き、3か所に流す。** `sw.js` は `node:vm` で読み込んで
  `safeTarget()` を取り出す（`sw.js` をexportさせたり書き換えたりしない）。**判定を直したら、
  この表へ入力を足す**
- **`isInternalPath()` が通した値は `new URL(値, オリジン).origin` が変わらない**という性質そのものも、
  1文字・2文字の組み合わせの総当たりで確かめている。表に無い入力の穴を拾うための保険
- テストファイルは `tsc`（`pnpm typecheck`）の対象にも入る。`.ts` 拡張子付きの相対importを
  書けるよう、`tsconfig.json` に `allowImportingTsExtensions` を足してある（`noEmit` なので影響しない）
- **書いてよい構文はNodeが型を剥がせるものだけ**（`enum`・`namespace`・パラメータプロパティは不可）

### 返答の生成をサブスク枠を使わずに確かめる

**そのまま使えるスタブが `scripts/codex-stub.sh` にある**（#205）。`.env.local` に
`CODEX_BIN="./scripts/codex-stub.sh"` と書いて開発サーバーを起こし直せばよい（返す本文・
待ち時間・引数の書き出し先は環境変数で変えられる）。以下はその仕組み。

**`CODEX_BIN` を差し替えて確かめる。** `src/lib/codex.ts` が
`process.env.CODEX_BIN ?? "codex"` を `spawn` するので、`codex exec --json` のJSONLを真似て
標準出力へ吐くだけのシェルスクリプトを指せば、実際のCodex（1往復で数十秒・サブスクの利用枠を
消費する）を呼ばずに動かせる。**#183からは朝の見通し（`POST /api/briefing`）も同じ手で通せる**
——スクリプトに `"$@" > argv.txt` のような1行を足しておけば、`-c mcp_servers.…` や
`disabled_tools` が実際に渡っているかも同時に読める。最低限必要な行は次の2つ。

```bash
echo '{"type":"item.completed","item":{"type":"agent_message","text":"<返答の本文>"}}'
echo '{"type":"turn.completed","usage":{"input_tokens":1200,"cached_input_tokens":800,"output_tokens":40}}'
```

### ヘッドレスChromeで画面を確かめる

**開発用ログインは、Cookieを差し込むよりログイン画面のフォームを押す方が確実**（#137で実測）。
`Network.setCookie` に `domain: "localhost"` でも `url: "http://localhost:<ポート>/"` でも
`/login` へ戻され続けた（原因は詰めていない）。`/login` を開いてから
`document.querySelector('form[action*="/api/dev/login"]').submit()` を
`Runtime.evaluate` で流せば、そのまま `/` に着地する。

**`--remote-debugging-port` を固定の番号（9333など）にしない**（#210）。このホストでは他Issueの
セッションが同時にヘッドレスChromeを起こしており、自分のChromeが起動に失敗していても
`http://127.0.0.1:9333/json/list` は**別セッションのChromeを返す**。#210で実際に、起動していない
Chromeへ繋いだつもりで別セッションのページを自分のログイン画面へ遷移させた（スクリプトは
正常に見える結果を返す）。開発サーバーのポートから導いた番号（`PORT + 20000` など）を使い、
起動した直後に `/json/version` の `webSocketDebuggerUrl` が自分の起動したプロセスのものかを
`ss -ltnp` のPIDで確かめること。

**画面の作り直しやリクエストと利用者の操作が競合する不具合は、CDPの
`Network.emulateNetworkConditions`（`latency` を1〜2秒）で再現できる**（#155）。サブPCの
開発サーバーはRSCの取得が0.2秒ほどで終わるため、素のままだと**競合する窓そのものが開かない**
——実機のスマホで起きることが手元では一度も起きない、という形になる。

**画面の動き（CSSアニメーション）を確かめるときは、`rsvg-convert` の書き出しを根拠にしない**（#49）。
librsvgは `transform-box` を解釈しないため、ブラウザでは正しい位置で動く部品が、書き出したPNGでは
まったく別の場所へ飛ぶ。ヘッドレスChromeは `~/.cache/ms-playwright/chromium_headless_shell-*/` に
入っており、Playwrightを使わなくても1枚だけなら撮れる。

```bash
chrome-headless-shell --headless --disable-gpu --no-sandbox --window-size=1060,300 \
  --screenshot=out.png "file:///<確認用のHTML>"
```

**撮った瞬間はアニメーションの0秒地点なので、途中の姿は写らない。** `--virtual-time-budget` を
足してもCSSアニメーションは進まない。見たい時点があるなら、確認用のHTML側で
`animation-delay: -0.5s` のように負の値を当てて、その姿で止めてから撮る。

### ホバーで出る要素を確かめる（#102。バツは#320で無くなったが、手順は他のホバー表示に使える）

**ヘッドレスChromeは既定で `hover: none` を返し、`Emulation.setEmulatedMedia` では変えられない。**
`features: [{ name: "hover", value: "hover" }]` を渡しても `matchMedia("(hover: hover)").matches` は
`false` のままで、**PCでの見え方を一度も再現できない**（`prefers-color-scheme` などは効くので、
効いていないことに気付きにくい）。PC側を確かめるときは起動フラグで固定する。

```bash
chrome-headless-shell --headless --disable-gpu --no-sandbox --remote-debugging-port=9333 \
  --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 \
  about:blank
```

ホバー中の見た目はCDPの `CSS.forcePseudoState`（`forcedPseudoClasses: ["hover"]`）で作る。
`Input.dispatchMouseEvent` で座標へ動かすより確実。**ホバーの無い端末（iPad・スマホ）は
既定のまま起こせばよい**ので、この2つを起こし分ければ「乗せたときだけ出る」を両側から確かめられる。

**ただし「ホバーが無い」と「ポインタが粗い」は別で、既定では `pointer: coarse` が立たない**（#166）。
既定のまま起こすと `matchMedia("(hover: hover)").matches` も `matchMedia("(pointer: coarse)").matches`
も `false` になるため、`@media (pointer: coarse)` だけで書いた出し分けは**既定の起動では一度も
当たらない**（当たらないまま「効いている」と読み違える）。タッチ端末を再現するときは
`--blink-settings=primaryHoverType=1,availableHoverTypes=1,primaryPointerType=2,availablePointerTypes=2`
を明示する（HoverTypeは `1=none` / `2=hover`、PointerTypeは `1=none` / `2=coarse` / `4=fine`）。
スタイル側も片方だけに頼らず、`@media (hover: none), (pointer: coarse)` のように両方並べること。

**検証用に一時的なページを足して消したら、`rm -rf .next` してから型チェックする。**
`next dev` が生成する `.next/dev/types/validator.ts` は消したルートを参照したまま残り、
`pnpm typecheck` と `pnpm build:ci` が `TS2307: Cannot find module '../../../src/app/<消した名前>/page.js'`
で落ちる。ソースにはもうそのファイルが無いので、原因がコードの側に見えない。

## ローカル開発

```bash
pnpm install
pnpm env:init            # .env.local.example を .env.local へコピーして編集する
pnpm db:setup            # .env.local の DATABASE_URL から DB・ユーザーを作成する
pnpm db:migrate:dev
pnpm dev                 # http://localhost:3000
pnpm dev:https           # 実機（iPhone）から見るときだけ。tailnetへHTTPSで公開する
```

Supabase の Redirect URLs に、開発で使うオリジンの `/auth/callback` を登録しておく必要がある。

### worktreeで画面を確認するときの注意

- **`.env.local` の `DATABASE_URL` は全worktreeで同じローカルDB（`app_aide_bot`）を指す。**
  別Issueのセッションが `prisma migrate dev` を流していると、こちらのスキーマには無いテーブルが
  すでに存在する。壊し合わないよう、検証で書き込みを伴う場合はDB名を変えて隔離する
  （`CREATE DATABASE app_aide_bot_issue<番号>` → `pnpm db:migrate:deploy` → 確認後に `DROP`）
- **`pnpm db:setup` は `sudo mysql` を使うので、パスワードを聞かれる環境では無人で通らない**（#233）。
  隔離DBを作るだけなら要らない——`setup-db.sh` は開発用ユーザーに `*.*` への `CREATE` / `DROP` を
  付けてあるので、`.env.local` の `DATABASE_URL` のユーザーのまま
  `mysql -u <ユーザー> -p -h 127.0.0.1 -e 'CREATE DATABASE app_aide_bot_issue<番号> …'` で作れる
  （ユーザーそのものが無いホストでだけ `db:setup` が要る）
- **`.env.local` はコマンドラインで前置きした環境変数より優先される**（#183）。
  `CODEX_BIN=… pnpm dev` のように前置きしても効かず、`.env.local` 側の値がそのまま使われる。
  **差し替えたつもりで前と同じ結果が出る**ので、値を変えて挙動を見比べるときは `.env.local`
  そのものを書き換えてから起こし直すこと（実測で、失敗するスタブを前置きしたのに
  `status: sent` が返り、`.env.local` を書き換えたら `status: failed` になった）
- **`.env.local` を書き換えると `next dev` は `Reload env: .env.local` を出すが、Route Handlerが読む
  値は切り替わらないことがある**（#226）。起動後に `NOTICE_INGEST_TOKEN` を足したところ、ログには
  reloadが出たのに `/api/mcp` は401のままで、起こし直したら通った。値を変えて挙動を確かめるときは
  reloadの表示を当てにせず、上の注意（前置きは効かない）と同じく起こし直すこと
- **Next.js 16の `next dev` は同じディレクトリで2つ起動できない**（`Another next dev server is
  already running.` で終了する）。ポートを変えても回避できないので、環境変数を変えて起動し直す
  検証では、先に動いているサーバーを落とす
- **落とす相手を `lsof -ti :<ポート>` で選ばない**（#164）。`lsof` はそのポートを**listenして
  いるもの**だけでなく、**繋いでいる側**も返す。ヘッドレスChromeで画面を確かめている最中は
  そのネットワークプロセスが混ざり、`kill` するとブラウザごと落ちる（実際に落とした）。
  listenしているものだけを見るには `ss -ltnp | grep <ポート>` を使う。**`pkill` は禁止**
  （他セッションのClaude Code本体を落とす）ので、PIDを1つずつ確かめて止める
- **`next start` も `.env.local` を読む。** 本番相当（`NODE_ENV=production`）での無効化を
  確かめるときは、開発用の値が読み込まれていることを `/proc/<pid>/environ` で確認したうえで
  試す。読み込まれていないだけなら「シークレット未設定」側の錠が効いただけで、確認にならない

## デプロイ

`main` へのpushで `.github/workflows/deploy.yml` が動く。GitHub Actions側でビルドし、成果物を
VPSへ配ってPM2で再起動する（VPS上で `next build` はしない。メモリが足りないため）。

**デプロイに必要な値の取得元は `.github/secrets-manifest.tsv` が正**。ワークフローの `env:` ブロックは
`scripts/generate-workflow-env-block.sh` で生成する。1Passwordは「人が管理する唯一の正」として残り、
値を変えたときだけ `scripts/sync-github-secrets.sh` でGitHubへ同期する
（実行時に1Passwordを読まない理由は guchi-apps/issue-deck#1302・#1307）。

### app-deploy-gate へ渡す（#567）

- **SSH先で任意のシェルを実行しない。** deployジョブはこのアプリ専用のSSH鍵（`SSH_PRIVATE_KEY`。正は
  `op://apps/morrow/deploy-ssh-key`）で、VPSのgate（`/usr/local/sbin/app-deploy-gate`。guchi-apps/vps#275）へ
  `upload`（`ssh … upload < deploy.tar.gz`）→ `env`（標準入力に `KEY=VALUE` を1行1変数）→ `deploy` の3語だけを送る。
  organization共通の `SERVER_SSH_PRIVATE_KEY` はもう使わない
- **gateのアプリ名は `aide-bot`**（リポジトリ名の `morrow` ではない）。gateは置き場
  `/home/github-user/apps/<アプリ名>` とpm2のプロセス名をアプリ名から決めるが、どちらも旧名 `aide-bot` のまま
  （`deploy/ecosystem.config.js` の `name`・guchi-apps/vps のREADMEのアプリ一覧）。VPSの `authorized_keys` の
  `command=` も `app-deploy-gate aide-bot` にする。`TARGET_DIR` はgateが置き場を固定するため使わなくなった
- 旧配布物の削除・展開・`.env` の更新・`pnpm install --prod`・`prisma migrate deploy`・pm2の再起動・稼働版の照合は
  gate側が行う。**`.env` へ書く値を足すときは「Send environment variables」の `printf` へ足す**（ここに無い値は
  `.env` に入らない）。`MIGRATE_DATABASE_URL` は `.env` へ書かれずマイグレーションだけに使われ、
  マイグレーション専用ユーザーが未設定なら通常ユーザーの `DATABASE_URL` で流す
- **改行を含む値はgateへ送れない**（送る前に `::error::` で落とす）。`APNS_KEY_P8` は複数行のPEMで登録されていても
  base64の1行へ直して送る（`normalizeP8()` がbase64を受ける）
- gateの外で走っていた処理は動かない。マイグレーション直前の処理が要るときは `deploy/pre-migrate.sh` に置く
  （gateが `DATABASE_URL`/`MIGRATE_DATABASE_URL`＝マイグレーション用で実行する）。このアプリは今は持たない
- 配布物から `scripts/construct-database-url.sh`・`scripts/update-env-file.sh` を外した（SSH先で使わなくなったため）

### 稼働版のSHAを照合する（#567）

- **ヘルスチェックはHTTP 200ではなく稼働版のSHAで判定する。** `deploy.yml` は `APP_COMMIT_SHA: ${{ github.sha }}`
  を「Send environment variables」の `env:` に持ち、`APP_COMMIT_SHA=…` としてgateへ送る。gateは `.env` に
  `APP_COMMIT_SHA` があれば、pm2の再起動後に `http://127.0.0.1:3103/api/app-version`
  （`src/app/api/app-version/route.ts`）の `sha` が一致するまで最大60秒待ち、一致しなければ失敗にする
  （guchi-apps/vps#298）。`/` は旧版が残っていても応答を返すため照合にならない
- issue-deckの新方式リリースは、対象コミットの `deploy.yml` を `self`（自前で照合）／`gate`（gateへ委譲）／`none` に
  分けて稼働確認の可否を決める（issue-deck の `src/lib/deploy-version-check.ts`。コメント行は根拠にしない）。
  このリポジトリは `gate`。`test/app-version-deploy.test.ts` がコメント行を除いた本文で委譲の形を確かめる
- `/api/app-version` はCookie無しで叩かれるため、公開経路（`src/lib/supabase/public-paths.ts`）に入れてある。
  返すのはバージョンとSHAだけ。Service Workerは `fetch` ハンドラを持たないので保存されない

### 初回デプロイの前に埋めるもの（#4）

**GitHubのsecret / variableは新規リポジトリでは空のまま**で、`deploy.yml` の `env:` は空文字を渡す。
`${{ secrets.X }}` は未登録でもエラーにならないため、失敗するのは値を実際に使う場所になる。
aide-botでは build ジョブの「Construct DATABASE_URL」が
`DB_NAME: DB_NAME is required` で落ちた（run 32648571956）。

初回は上流の1Passwordアイテムごと存在しないので、次の順で埋める。**どれもエージェントは代行できない**
（1Passwordへの書き込み・Signalyのチャンネル作成・本番デプロイの実行はいずれも人の操作）。

1. Signalyでこのアプリ用の通知チャンネルを作り、Webhook URLを控える
2. 1Passwordの `apps` ボールトに `aide-bot` アイテムを作り、`target-dir` / `db-name` /
   `allowed-google-emails` / `ci-webhook-url` を登録する。値の形は他アプリのアイテムに揃える
   （`target-dir` は `/home/github-user/apps/aide-bot`、`db-name` は `app_aide_bot`）
3. `eval $(op signin)` の後に `scripts/sync-github-secrets.sh --dry-run` → 本実行。
   **個人アカウントで実行する**（サービスアカウントは日次1,000リクエストの共有枠を消費する）
4. `gh api repos/guchi-apps/morrow/actions/secrets --jq .total_count` で登録件数を確かめてから
   Deploy to Production を再実行する

**secretを埋めてもまだ公開はされない。** gateのヘルスチェックはVPS内の
`http://127.0.0.1:3103/api/app-version` を叩くだけなので、Apacheのvhostが無くてもdeployジョブは成功する。
`https://aide-bot.gucchii.com/` を通すには `guchi-apps/vps` 側でvhostとTLS証明書を用意し、
アプリ一覧へ3103を登録する必要がある（`curl` でTLSハンドシェイクが
`no alternative certificate subject name matches` になる間は未設定）。

### マイグレーションSQLにdotenvの出力を混ぜない（#9）

`prisma.config.ts` の `loadEnv()` には **`quiet: true` を必ず付ける**。dotenv v17は読み込み時の
案内文を**stdout**へ出力し、Prismaは同じstdoutへ `migrate dev` / `migrate diff --script` の
SQLを書き出すため、案内文がそのまま `migration.sql` の1行目に入り込む。

ローカルでは誰も実行しないので気付けず、本番の `prisma migrate deploy` で初めて
MariaDBの構文エラー（1064 / P3018）として出る。実際に `20260823000000_init` がこの形で壊れ、
初回デプロイが失敗した（run 32720715118）。

マイグレーションを追加したら、コミット前に生成物と突き合わせる。

```bash
pnpm exec prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
```

**本番で一度失敗したマイグレーションは、直したSQLを配っても自動では復旧しない。**
`_prisma_migrations` に失敗として記録が残り、以後の `migrate deploy` はP3009で止まる。
VPS上で `pnpm exec prisma migrate resolve --rolled-back <マイグレーション名>` を実行してから
デプロイし直す。

### 必須の列を後から足すときは、書き込み側を全部洗う（#114）

**DB側の `DEFAULT ''` はPrisma Clientの必須判定には効かない。** 既存行が埋まるのと、
`create` / `upsert` で省略できるのは別の話で、スキーマに `@default` を書かない限り
**その列を渡していない書き込みは実行時に `Argument \`title\` is missing.` で落ちる。**

`Notice.title`（`20260830160000_add_notice_title`）がこの形で、`scripts/seed-ci-db.mjs` の
`NOTICE_SEEDS` に1件だけ `title` を持たない行があり、**その時点から `pnpm db:seed:dev` が
失敗していた。** ローカルDBを作り直す機会が無く、#114 まで気付かれていない。
**`pnpm lint` も `pnpm typecheck` も `pnpm build:ci` もこれを検知しない**（型の上では
必須になっており、落ちるのは実際に書き込んだときだけ）。列を足したら、新しいDBへ
`pnpm db:migrate:deploy` → `pnpm db:seed:dev` を通して確かめること。

**上と同じ理由（`Notice.title` にDB側だけ `DEFAULT ''` が残り、`schema.prisma` には
`@default` が無い）で、`prisma migrate dev` で他の列を足すたびに無関係な
`ALTER TABLE Notice ALTER COLUMN title DROP DEFAULT` が生成物へ混ざる**（#121で実際に
踏んだ）。Prismaは「スキーマとDBの差分」全体を1つのマイグレーションにまとめて出すため、
狙った変更（例: 別テーブルへの列追加）だけを切り出してはくれない。**生成されたSQLは必ず
目を通し、今回の変更と無関係な行が混ざっていたら手で取り除く。** 残したままコミットすると、
関係の無いPRで本番の`Notice`テーブルの挙動が変わる

### 新しいworktreeで開発サーバーを動かすには（#121）

**新しく作ったworktreeに`.env.local`が無いことがある**（本体チェックアウトからコピーされる
想定だが、実際には空のことがあった）。`pnpm env:init`で`.env.local.example`からコピーした
だけでは、`NEXT_PUBLIC_SUPABASE_URL`・`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`が空文字のままで、
**`next dev`を起動しただけでmiddleware（`src/lib/supabase/middleware.ts`）が
`Your project's URL and Key are required` で全リクエスト500になる**——開発用ログイン
バイパス（`isCiBypassRequest`）はこのSupabaseクライアント生成より前で判定しているが、
バイパスが効くのはCookieを持ったリクエストだけで、`POST /api/dev/login`自体もmiddlewareを
通るため道連れで落ちる。CIのビルド（`.github/workflows/ci.yml`）と同じダミー値
（`https://ci-placeholder.supabase.co` / `ci-placeholder`）を入れれば、実際のSupabase
プロジェクトが無くても開発用ログインの経路までは動く。あわせて`PORT`（worktree用に
割り当てられた値）も`.env.local`に無ければ追記が要る（`scripts/dev.sh`が読む）。

---

# Issueごとの複数Claude Codeエージェント運用

`@claude` コメントを起点に、計画提示〜実装〜develop向けPR作成〜レビュー〜マージまでをGitHub Actions上で
無人実行する運用を導入している。仕組みの本体は `guchi-apps/issue-deck` にあり、aide-botはその
再利用可能ワークフロー（`workflows/v27` タグ）を参照する側として構成している。

設計の詳細・各モードの判定ロジックは issue-deck の `docs/multi-agent-workflow.md`・`docs/multi-agent/` を
一次情報源とする。ここにはaide-bot側の運用に必要な事項のみを置く。

## ブランチ運用

- `main` は本番と一致するリリース用ブランチ。直接pushは禁止し、`develop` → `main` のPRのみで進める
- `develop` が日常の開発ブランチ（デフォルトブランチ）
- Issue専用ブランチは `develop` から作成し、ブランチ名は `issue-<Issue番号>` とする（例: `issue-12`）。
  進捗遷移・レビュー・コンフリクト解消の各ワークフローはこの命名規約からIssue番号を特定するため、
  従わないブランチはすべて対象外になる
- worktreeは本体リポジトリの外（`~/apps/aide-bot-worktrees/<ブランチ名>/`）に作成する。
  本体 `~/apps/aide-bot` は `develop` の最新チェックアウトとして空けておく

## Issueの進捗

**進捗はGitHub ProjectsのStatusで管理する。唯一の正はStatusで、進捗ラベルは存在しない。**

原則として以下の順で遷移する。`Planning` は `21.plan-required` が付いている場合のみ経由する。

1. `Ready` — 未着手
2. `Planning` — 計画を検討中
3. `Implementation` — 実装中
4. `Develop PR` — developへPR作成・マージ中
5. `Develop` — developへマージ完了（main未反映）
6. `Release` — mainへのPR作成・マージ中
7. `Done` — mainへマージ完了。**この時点でissueをclose**する

**`gh issue edit` で進捗を進めることはできない。** Statusを書けるのはissue-deckだけで、
ワークフローは進捗報告API（`POST /api/progress`）へ報告する。ブランチのpush・PR作成・PRマージを
トリガーに自動で遷移するため、**エージェントが自分で進捗を動かす必要はない。**

`00.check-user`（ユーザーの確認・指示が必要）は、上記のどの段階でも他のラベルと併用して付与する。
`00.check-user` を人間が外す操作が「承認」を意味する。理由は `01.check-*` で併記する。

オプション制御のラベル:

| ラベル | 効果 |
|---|---|
| `21.plan-required` | 実装前に計画を提示し、承認を得てから実装に入る |
| `22.merge-confirm-required` | 内容によらず、developへのマージ前に必ず `00.check-user` を付ける |
| `23.preview-required` | PR作成前に開発サーバーの画面で確認し、承認を得る |
| `24.screenshot-required` | PR作成前にスクリーンショットで確認し、承認を得る。**無人実行ではまだ使えない**（開発用ログイン（Cookieバイパス）は#25で入ったが、スクリーンショットを撮るPlaywright依存とワークフロー側の手当てが無いため） |
| `25.artifact-required` | 実装着手前に見た目のアーティファクトを公開し、承認を得る（ローカル実行専用） |
| `11.local` | 付いている間、無人実行ワークフローが計画・実装・分割・追加対応を行わない。ローカルのClaude Codeセッションと二重に進めないための停止フラグ |
| `71.manual-step` | エージェントが代行できないユーザー自身の手作業を追跡するIssue |

## 自動マージ不可カテゴリ

以下に該当する変更は、レビュー・統合エージェントが自動マージせず `00.check-user` を付与して
ユーザーの確認を待つ。`claude-review-develop.yml` の `risk-check` ジョブがパスパターンで一次判定し、
パターンに掛からない意味的なリスクはレビューエージェントが二次判定する。

- 認証・認可（`src/proxy.ts`、`src/lib/supabase/**`、`src/lib/allowed-users.ts`、`src/app/auth/**`）
- DBスキーマ変更・マイグレーション（`prisma/migrations/**`）
- 本番環境の設定（`deploy/**`、`.github/secrets-manifest.tsv`）
- GitHub Actionsやデプロイ設定（`.github/workflows/**`）
- Secretsや環境変数（`.env*`）
- 課金・決済
- 大規模な依存関係の更新（`package.json` のメジャーバージョン更新）
- `develop` → `main` のマージ

無人実行では確認する相手がその場にいないため、**新しい依存関係の追加が必要になった場合は追加せず**、
`00.check-user` と `01.check-blocked` を付与して停止する。シークレットの実値は、コミット・PR本文・
Issueコメント・ログのいずれにも書かない。

## 並行Issueの意味的コンフリクト（develop向けPRを出す前に確認する）

develop向けPRのCIは、PRを出した時点の `develop` に取り込んだ結果に対して走る。その後に別のIssueが
developへマージされてもCIは自動では回り直さない。このため、**テキスト上は競合しないのに develop 上で
壊れる変更**が、そのまま自動マージで入りうる。

Prismaスキーマのフィールド削除・関数やエクスポートの改名・型の変更を含むIssueと並行して作業している
場合、PR作成の直前に `git fetch origin && git merge origin/develop` してから `pnpm typecheck` を
通す。CIの結果だけを根拠にしない。

## 実装エージェントの禁止事項

- `main` / `develop` への直接コミット・push
- 他Issueのブランチ・worktreeの編集
- 担当Issue以外の実装（別件の起票は可。実装は別セッションで行う）
- 不要なforce push
- 自分が作成したPull Requestの自己マージ
- 共有知識リポジトリ（`.shared-context/` / `~/apps/_docs`）の編集・コミット

レビュー・統合エージェントは、加えて `main` への直接マージ・pushを行わない。

## PR本文テンプレート

`develop` 宛のPRには以下を記載する（日本語で書く）。

- 対応Issue（`closes #番号` / `fixes #番号` は使わず `#番号` のみ。developマージ時点ではissueを
  closeしない運用のため）
- 実装内容
- テスト内容
- 確認方法（画面に関わる変更ではアクセスURLと操作手順）
- 注意点

コミットメッセージ・PRタイトル・PR本文・Issueコメントは日本語で書く。コミットのAuthorは
`Claude Code <claude-code@example.com>` にする。

## ワークフローの構成

すべてissue-deckの再利用可能ワークフローを `@workflows/v27` で参照する薄いcallerで、
ジョブ本体はこのリポジトリに持たない。

| ファイル | 内容 |
|---|---|
| `issue-labels.yml` | 進捗（Project Status）の報告 |
| `claude-issue-dispatch.yml` | `@claude` 起点の計画・実装・PR作成 |
| `claude-review-develop.yml` | develop向けPRの自動レビュー・リスク判定・Auto-merge |
| `claude-conflict-resolve.yml` | developとのコンフリクト自動解消 |
| `claude-ci-fix.yml` | CI失敗の自動修正 |
| `claude-pr-repair.yml` | Issueに紐づかないPRの修復（画面のボタンから起動） |
| `deploy-retry.yml` | デプロイ失敗の再実行（画面のボタンから起動） |
| `sync-secrets.yml` | 1Password（正）からこのリポジトリのsecret / variableへ同期（画面のボタンから起動） |
| `release-develop-to-main.yml` | バージョンbump PR・develop→mainのリリースPR作成 |
| `version-tag-check.yml` | main宛PRでのリリースタグ重複・デプロイ設定漏れの検査 |

**参照しているタグは正ではない。** 上げたらこの表も直すが、実態は `.github/workflows/` の
`uses:` を見るのが確実。**`uses:` のタグと `prompts-ref` は必ず同じ値にする**
（片方だけ上げると新しいワークフローで古いプロンプトが動く）。

### callerに書ける `with:` は、参照しているタグ時点の再利用ワークフローが持つ入力だけ

**存在しない入力を渡すと `startup_failure` になる。** ジョブが1つも作られず、ログも残らないため
原因が分かりにくい。タグを上げるときも、増やした入力がそのタグに実在するかを確かめる。

実際に踏んだ形（aide-bot#1）。

- **`database-name` を受け取るのは `reusable-issue-dispatch.yml` だけ。**
  `reusable-claude-ci-fix.yml`・`reusable-claude-conflict-resolve.yml` には無い。
  DBを使うリポジトリで揃えたくなるが、渡してはいけない
- **`reusable-deploy-retry.yml` は `workflows/v25` に存在しなかった**ため、当時は
  `deploy-retry.yml` のcallerを置けなかった。`workflows/v27` には入っているので現在は置いてある

確認は次のコマンドでできる（issue-deckのチェックアウトが手元にある場合）。

```bash
cd ~/apps/issue-deck
git show workflows/v27:.github/workflows/reusable-claude-ci-fix.yml | awk '/^  workflow_call:/,/^jobs:/'
```

### CIのチェックが `queued` のまま完了しないとき（#85）

**GitHub Actions側の障害中に作られたrunは、ジョブが1つも作られないまま壊れる。**
runそのものは `completed` / `failure` になるのに、`lint-and-build` の**check runだけが
`queued` のまま永久に残る**。`develop` の必須チェックはこの1つだけなので、PRは
`mergeStateStatus: BLOCKED` から動かなくなり、レビューも自動マージも「CI待ち」で止まる。
2026-08-26のActions障害（15:11〜18:01 UTC。DBのプライマリ障害）でPR #84がこの状態になった。

- **見分け方は「runは終わっているのにジョブが0件」**。ログが無いので `--log-failed` では何も出ない

  ```bash
  gh api repos/guchi-apps/morrow/actions/runs/<runID> --jq '{status, conclusion}'   # completed / failure
  gh api repos/guchi-apps/morrow/actions/runs/<runID>/jobs --jq .total_count        # 0
  gh api repos/guchi-apps/morrow/commits/<PRのheadSHA>/check-runs \
    --jq '.check_runs[] | select(.status != "completed") | .name'                     # lint-and-build
  ```

- **`gh run rerun` はCIを走らせ直さない。ブロックだけを外す。** 壊れたrunのレコードを
  再利用するため、再実行しても `run_attempt` は1のままジョブが作られない（#85で25分待って
  0件を実測）。**一方で、再実行した時点で古いcheck runがheadのSHAから消える。**
  必須チェックが「Queuedのまま」ではなく「存在しない」状態になるので、**PRのブロックは
  外れる**——#85では再実行の約23分後に、15:33の時点で有効化されていたAuto-mergeが
  そのままPR #84をマージした。**CIが通ったのではなく、チェックごと消えて通り抜けた**ので、
  これに頼るなら中身は別の手段で検証しておくこと
- **CIを実際に走らせたいなら新しいrunを作る。** `workflow_dispatch` を足してあるので、
  まずこれを使う。check runはブランチ先端のSHA（＝PRのhead）に付くため、必須チェックも満たせる

  ```bash
  gh workflow run ci.yml --repo guchi-apps/morrow --ref issue-<番号>
  ```

- それでも駄目なら**PRをclose → reopen**する（`pull_request: reopened` でCIが走る）。
  空コミットのpushでも直るが、**他Issueのブランチを書き換えることになるので最後の手段**
- **障害の窓に入ったrunは他のワークフローにもある。** `Issue Labels` などが `queued` のまま
  居座っていても実害は無いが、`gh api ".../actions/runs?status=queued"` で範囲を把握しておくと
  「今も壊れているのか、当時のものが残っているだけか」を切り分けられる

無人実行のたびに `.shared-context/`（共有知識）と `.shared-prompts/`（issue-deck側の
実装プロンプト）がワークツリーへcheckoutされる。**どちらもこのリポジトリの管理対象ではない。**
`.gitignore` 済みなので、**編集・`git add`・コミットを一切行わないこと。**
