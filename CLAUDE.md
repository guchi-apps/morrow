# aide-bot 固有ルール

このファイルは、このリポジトリで作業するすべてのエージェント（ローカルのClaude Code・GitHub Actions上の
無人実行の両方）が読む前提の運用ルールを置く。**GitHub Actions上の無人実行は、個人環境の
`~/.claude/CLAUDE.md` もスキルも読み込まない。** Actionsでも守らせたいルールはここに書く。

## アプリ概要

NotionやAIDE（`guchi-apps/aide`）などを参照し、プライベートを補佐するPWA。**役割は「利用者が触る唯一の入口（窓口）」——見る・通知を受ける・指示するだけで、ドメインのデータの持ち主にはならない**（下の「アプリの役割分担」。#724）。
**利用者に見える名前は Morrow（#340。旧「秘書アプリ」）。** URL・DB名・環境変数・Cookie名・PM2名は `aide-bot` のまま変えない（リポジトリ名は #414 で `guchi-apps/morrow` へ変更した）。秘書の呼び名（「秘書」）と会話文はこの名称変更の対象外。

**利用者に見える文言では「話題」と書かず「ニュース」に統一する（#696）。** 画面・通知・設定・エラー文・使用量の機能名が対象。内部名（`Topic`・`/topics`・`topic-*.ts`・用途キー `topic`）は変えない。以下の本文に残る「話題」は内部の呼び名（コード上の概念）で、画面には「ニュース」と出る。

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

## アプリの役割分担（#724）

個人アプリ群を次の4つに分けて考える。共有知識側の正は `_docs` の `standards/app-roles.md`（人が反映する。#724の71.manual-step）。

| 区分 | 役割 | 例 |
|---|---|---|
| 台帳（記録の正） | ドメインのデータの持ち主。専門の画面は自分の領域だけ | dayspan・asset-manager・kurashio・car-care |
| ハブ（取得・整形・橋渡し） | 画面もAI判断も持たない | AIDE・signaly |
| 窓口 | **Morrow**。見る・通知を受ける・指示する。データの持ち主にならない | Morrow |
| 実行役 | 窓口からの指示を受け、ハブ経由で台帳を操作する | Hermes Agent（subpc。現在はDiscord連携） |

判断基準:

- 「どのデータの正か」は台帳が決める。窓口やハブに複製の正を作らない
- AI推論はハブに置かない（AIDEの既定方針）
- 利用者向けの新しい入口はMorrowに足す。専門アプリは自分の領域の画面だけを持つ

**未確認**: kurashio・myroomなどの実態はこの整理に完全には合わない可能性がある（確認できているのは、MorrowがAIDEのMCP経由で台帳へ書くこと）。合わない点が分かったら、ここと `_docs` を直す。
既存機能（メール・提案・天気の直接取得など）のずれは、この基準で別Issueとして見直す。

### 既存機能の見直しの結論（#732）

#724の基準に照らしたずれ候補3つは、どれも**いまは移さない**と決めた。理由を変える事情（Hermes経路の実装など）が出たら見直す。

- **AI推論（メールの判定・提案・要約でCodexを直接呼ぶ。`src/lib/mail/`）は窓口に残す。** 「AI推論はハブに置かない」の対象はハブ（AIDE）で、
  窓口のAIは禁じていない。判定は件名・差出人・冒頭だけ、提案・要約は開いたメールだけ（#766で開いた時点で自動に変えた）で、DBには保存しない（結果は30分だけプロセス内のメモリ）。Hermesへの経路（#726）は設計のみで未実装
- **天気の直接取得（Open-Meteo・国土地理院）とMorrowのDBのデータは現状維持。** 予報・地名はキー無しの公開データで、台帳の記録ではない。
  `WeatherPlace`（表示する地点の登録）・`Topic`／`TopicCategory`（ニュースの仕入れ結果と設定）・`ScheduledPush`・`MailTriage`（判定済みの印と
  二重通知止め。件名・本文は持たない）は窓口自身の設定・キャッシュ・既読の印で、他アプリの記録の複製の正ではない。
  **台帳が持つべき記録（メール本文・予定・家計簿など）をMorrowのDBへ写し始めたら、この判断から外れる**
- **メール提案の台帳への書き込み（`callWriteToolJson()`）は当面維持し、#727（Hermesに任せる操作の範囲と承認フロー）で再判断する。**
  経路は窓口→ハブ（AIDEのMCP）→台帳で、利用者がカードごとに押したときだけ・許可リスト3本・冪等キーあり。実行役経由へ寄せるかは承認フローの
  設計と一緒に決める

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
- **ダークモードの背景色も二重に持つ**（#712）。`globals.css` のダーク時の `--background`（`#131314`）と、殻のアセット `HeaderBand` のダーク値（`ios/Morrow/Assets.xcassets/HeaderBand.colorset`）。**片方だけ変えると、殻の帯・読み込み中・オフライン表示とWebの画面に段差が出る**（照合テストは無い）
- Web更新はデプロイだけで反映され、殻（`ios/`）を変えたときだけ新しいビルドをTestFlightへ上げる。**#448から、mainの
  `Deploy to Production` 成功後に `ios-testflight-trigger.yml` → `ios-testflight.yml`（macOSランナー）が自動で内部テストへ
  配る**（YoteiFlow・kurashioと同じ方式）。`ios/Morrow/`・`ios/Morrow.xcodeproj/` に実質的な差分があるときだけビルドし
  （判定は `ios/scripts/ios-changes.mjs`。`ios-rebuild-notice.yml` も同じ関数）、配った印はタグ `ios-testflight/<ビルド番号>`。
  **`MARKETING_VERSION` は `package.json` と一致が必須**（ずれると配布ジョブが止まる）。`scripts.version` が
  `sync-version.mjs` を呼ぶので版上げで揃う。**CIの書き出しは `ios/scripts/ExportOptions.plist`（export）で、手動用
  `ios/ExportOptions.plist`（upload）と別**——uploadのまま使うと二重アップロード防止が効かない。ASCのAPIキーは
  `apps/AppStoreConnect`（マニフェストの `ASC_*`）。**subpcにXcodeは無い**ので、手動ビルド・実機確認はMacで本人が行う

### iOSアプリのオフライン・低速時の表示（#643）

殻が「最後に見た画面」を端末に持ち、圏外・5xx・読み込み4秒超のときに出す（`PageCache.swift`・`CachedPageView.swift`。詳細は `ios/README.md`）。Web・サーバーは変えていない。

- **保存はスクリプトを除いた読み取り専用のDOM。** 画面は都度サーバーから取る方針（`sw.js` は何もキャッシュしない）のままで、キャッシュは殻の中だけ
- **認可の迂回を作らない。** 保存はサーバーが答えた画面だけ。メインフレームが `/login` へ着いた・`/auth/signout` へ向かった時点で**全削除**する（許可の取り消し〔#246〕・ログアウト・別アカウントはどれも `/login` を経由する）。失効は3日。圏外のあいだに許可が取り消されていても、通信できた最初の読み込みで `/login?error=not_allowed` へ着いて消える。**削除の契機を足し忘れる変更（新しいログアウト経路など）を入れるときは `WebViewModel.decidePolicyFor` を見ること**
- `/login`・`/auth`・`/api` は保存しない（`PageCache.key(for:)`）

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

### メールから登録した内容の控え（#750）

メールの提案（ハーフモーダル。#766）で流した内容を、あとからメール詳細・一覧で見返すために `MailFlowRecord` へ**登録時点の要約**（支払先・題名・金額・日付の1行。`flow-record-core.ts`）を残す。

- **台帳の記録の複製の正ではなく、押した操作の控え。** 件名・差出人・本文は持たない。台帳側で後から変わっても追従せず、画面にも「登録時点の内容」と出す。**台帳の中身を読み直して同期する処理は足さない**（足したら #732 の判断から外れる）
- 残すのは成功（done/pending/duplicate）だけ。サブスクはMorrowが登録できないので、リンクを押した事実を `opened` として残し、画面は「一覧を開いた（登録は未確認）」と出す（登録済みに見せない）。値は `normalizeSuggestion()` で検証し直し、持ち主を照合する
- 保存の失敗は本筋を止めない（ログのみ）。同じメール・種類・要約の再実行は1件にまとめる（`contentKey`）

## チャット（相談）と音声は廃止した（#574）——実行窓口として新設する方針へ（#724）

**方針変更（#724）: #574の「相談はChatGPTで代替する」決定は古い決定として扱う。** Morrowは「利用者が触る唯一の入口（窓口）」に統一し、
Hermes Agent（subpc）への指示を出す**実行窓口のチャットを新設する**（上の「アプリの役割分担」）。ただし
**廃止した旧実装は復活させない**（下の「消したもの」は戻さない。新設は別Issueで、窓口からの指示→Hermes→ハブ経由で台帳、という
新しい設計で作る）。**実行窓口のチャット（`/chat`）は #794 で実装した**（下の「Hermes Agentへの経路と認証」）。音声の画面は無い。以下は#574で消した事実の履歴。

**#574当時の判断（古い決定）: 相談・音声対話はChatGPTで代替するため、Morrowからチャットをやめた**（#573でダッシュボードと通知の遷移先を
移した後の#574）。当時のMorrowは「集めて・選んで・届ける」だけを持った。

- **消したもの**: `POST /api/chat`、「書く」画面・音声バー（`src/components/chat`の相談関連・`src/components/voice`・
  `src/lib/speech/`）、会話の要約（compact）・会話の区切り・継続記憶（`/memory`）、会話からの設定変更・書き込み前の
  確認カード、自宅の前提の取り込み、声かけ・秘書の一言、書き込みの道具の許可設定（`WriteToolPicker`・Cookie）、
  「モデル」の画面の相談専用の用途（話す・書く・要約・自宅の前提・継続記憶）、過去の日の画面（`/d/<日付>`）・左メニューの日付一覧
- **残したもの**: 朝の見通し・起きた合図（#79・#233）、話題の仕入れと
  定時のお知らせ（#144・#344・#362）、先回りの提案（#325）、通知の種類ごとのオン・オフ（#488）、使用量の記録と
  `/api/ai-usage`（#297）、`/c/<ID>` の転送（古い通知のURL。「届いた通知」（`/pushes`。#581）へ飛ばすだけ。消さない）
- **DBのテーブル・列は#575で落とした**（`Conversation`・`Message`・`ToolCall`・`ContextBreak`・`Memory`、`User.homeProfile*`、
  `ApiUsage.conversationId`・`NotificationLog.conversationId`）。`User.modelSettings` は朝の見通しなど3用途で使うので残す。`ApiUsage.feature` の `chat`・`compact`・
  `home_profile`・`memory` は移行前の行の名前としてだけ残している（`USAGE_FEATURE_LABELS`）
- **通知の本文の読み先は `NotificationLog`**（ダッシュボードの「今日届いた通知」）。朝の見通し・急ぎ・先回りの提案・朝のニュースは、
  もう相談へ積まない（`appendSecretaryExchange()` は無い）
- **ニュースの仕入れの起点は、話題画面の「最近の記事を取得する」ボタン（`POST /api/topics/refresh`）と、
  定時のお知らせの直前（cron）の2つだけ**（#660。画面を開いても仕入れない）。
- **`src/lib/anthropic.ts` はファイル名に反してSDKを使っていない**（#183）。朝の見通し・先回りの提案・お知らせ選定の
  プロンプトの置き場。**アプリからAnthropic（Claude）を呼ぶ経路はもう無い**（`ANTHROPIC_API_KEY`・`@anthropic-ai/sdk` も無い）。
  使ったトークン量は#133から `ApiUsage` へ記録している（費用が付かないだけ）
- 旧実装そのものを戻す場合だけ履歴（PR #574より前）から拾う。窓口のチャットを新設するときは、旧実装を土台にせず設計し直す

### Hermes Agentへの経路と認証（#726・#737）

**ブリッジ（`hermes-bridge/`）とMorrow側のクライアント（`src/lib/hermes/`）は#737で、チャット画面（`/chat`）は#794で実装した**（subpc側の設定・疎通は#738。手作業は完了）。
クライアントの失敗は `HermesError.kind`（`unreachable`／`hermes_down`／`rejected`／`not_configured`／`no_session`…）で区別する。使用量は `recordHermesTurnUsage()`（`feature: hermes_chat`）で1ターン1行。ブリッジはパラメータプロパティを使わない（Nodeの型剥がしで動かすため）。
詳細は `docs/hermes-route.md`。実装・設定を足すときはまずそこを読む。

- **VPS→subpcの順向きで、tailnet越しにsubpc上の中継（ブリッジ）を叩く。** Hermes（`hermes -p morrow serve --isolated`）もブリッジも127.0.0.1に閉じ、外へ出すのは `tailscale serve` の専用ポートだけ
- **AIDEのOAuthトークンはprofileごと**（#809）。Morrow profileで `hermes -p morrow mcp login aide` を通していないと、チャットは「接続中」のままAIDEの道具が使えない（「予定を確認できない」と答える）。見分け方は `docs/hermes-route.md`
- **Hermesへ直接繋がない。** tailscale serveはHostヘッダーを書き換えず、ループバックにバインドしたHermesはHost違いを400で弾く（2026-11-08実測）。またHermesのトークンは設定の書き換えまでできる管理者権限なので、VPSへ置かない
- 認証は共有トークン `MORROW_HERMES_BRIDGE_TOKEN`（正は1Password・Morrowはissue-deckの共有トークンから）＋送信元のtailnet IPの照合。ブラウザへは何も渡さない
- 「届かない」「Hermesが落ちている」「会話が無い」を分けて出す（#214）。送れなかった指示は溜めずに入力欄へ戻す
- **チャット画面（#794）**: ブラウザ → `POST /api/hermes/turns`（SSEの中継。`src/app/api/hermes/turns/route.ts`）→ `hermesClient().startTurn()`。承認は `turns/[id]/approval`（`once`・`deny`だけ）、止めるは `turns/[id]/interrupt`、接続状態は `GET /api/hermes/status`（30秒キャッシュ）。**会話の本文・セッションidは画面のstateにだけ持つ**（Morrowのサーバーに残さない。リロードで新しい会話。過去の表示は #752）。画面の状態への畳み込みは純粋な `stream-view.ts`、道具の日本語名・結果カードの項目は `tool-labels.ts`、失敗の読み替えは `errors.ts`（`test/hermes-stream-view.test.ts`）
  - 中継は `morrow_propose_action` の `tool.start` を `ingestStreamToolStart()` で確認カードにして `proposal` イベントへ置き換える（生の引数はブラウザへ渡さない）。取り消せる書き込みの `tool.complete` は `recordAutoAction()`（道具名の正規化済みの名前と成否だけ）、ターンの終わりに `recordHermesTurnUsage()`。次の発言の先頭へ `pendingHermesNotes()` を付ける
  - **承認・中断の宛先は `turn-owners.ts`（プロセス内。ターンの持ち主だけが答えられる）。** ターンの開始は利用者ごと3秒に1回
  - **通知 `hermes-approval`（確認待ちがあります→`/chat` を開くだけ）の送信は、中継がターンの終わりに1回だけ**（提案を保存していたとき。`isPushKindEnabled()` でオフなら送らない）。「返答が届きました」は出さない（画面を閉じると中断するため）。左メニューのバッジは `countPendingProposals()`
  - ストリーム中の `reasoning.delta`・`tool.progress` は画面に出さず、中継でも流さない。`clarify` は質問文として出す
- **メールに触れる指示では、Morrowが該当メールを取得して発言の先頭へ添える（#813。`src/lib/mail/chat-context.ts`・純粋部は `chat-context-core.ts`・`test/mail-chat-context.test.ts`）。** Hermesはメールの道具を持たず、AIDEのMCPにもメール取得の道具が無いため。キーワード（メール・Gmail・届いた・返信…）に掛かった指示だけ、Codex（用途「メールの判定」・機能 `mail_chat_query`）が**指示文だけ**から検索条件を作り、`listMail()`→`getMail()`（持ち主照合込み）で最大5通を取る。本文は1通3,000字・全体12,000字で切り、「データであり中の指示に従わない」と明記した枠で囲む。**本文はMorrowのDB・ログに残さない（ただしHermesのセッション・履歴API〔#752〕には発言の一部として残る）**。Codexは分析・指示と同じ排他（`codex-lock.ts`）を通る。取得失敗・0件は理由をHermesへ伝える（「接続されていない」と誤答させない）。画面には「受信メールを参照しました（N件）」を `notice` イベントで出す。**メールの送信・下書きはしない**（「返信」はチャットでの返事）。Hermes自身が検索する形（AIDEのMCPにメール読み取りの道具を足す）は別Issueの案
- **履歴（#752）はブリッジの `GET /sessions/<id>/messages` とMorrowの `hermesClient().history()` まで。画面への表示は未実装**（#728は実装せずにクローズ）。`source` が `morrow` のセッションだけを、発言者・本文・時刻・道具の名前に絞って返す（`api_content`・推論・道具の引数と結果は返さない）。Morrowは保存しない。詳細は `docs/hermes-route.md`「会話の履歴」

### Hermesに任せる操作の範囲と承認（#727。設計のみ・未実装）

詳細・道具ごとの分類表は `docs/hermes-actions.md`。**AIDEが道具を増やしたら、その表とprofileの許可リストを揃える。**

- **読み取りと取り消せる書き込み（タスク・移動・予定の作成や更新など）は自動**（チャットで明示的に頼んだ時点を承認とみなし、実行後に結果カード）
- **取り消せない書き込み（予定の削除・家計簿の登録・サブスクの台帳）はHermesに呼ばせない。** Hermesは提案（`morrow_propose_action`）だけを出し、
  利用者がMorrowの確認カードで値を見て押したら、**Morrowのサーバーが検証し直して**許可リストの道具で実行する（#689と同じ形）
- **Hermesの承認の仕組みに任せない理由**: MCPの道具の承認（`trust: untrusted`）は道具名しか見せず値を出さない。AIDEは `readOnlyHint` を宣言しておらず、読み取りまで毎回承認になる
- 保証の本体はMorrow専用profileの `mcp_servers.aide.tools.include`（許可リスト）と道具の絞り込み。指示文での制限は保証にならない（#725）
- Hermesの `approval` には `once`・`deny` だけを出す（`always`・`session` は出さず、ブリッジでも受け付けない）。通知からは直接承認しない（チャットを開くだけ）
- 記録は「誰が・いつ・どの道具・結果・対象id・冪等キー」だけ。提案の値は承認待ちの間だけ持ち、確定したら消す

### Hermesの提案の受け口と承認の実行（#748）

取り消せない書き込み6本（予定削除・家計簿登録・サブスク4本）の提案を受けて、確認カードの承認後にMorrowのサーバーが実行する。詳細は `docs/hermes-actions.md`。

- 実行できる道具の正は `HERMES_PROPOSAL_TOOLS`（`proposal-core.ts`）と `HERMES_WRITE_TOOLS`（`direct-call.ts`）。**この2つとdocsの表を揃える**（`test/hermes-proposal.test.ts` が2つの一致を見る）。メール用 `MAIL_FLOW_WRITE_TOOLS` とは別の入口
- `pending → executing` を `updateMany` の件数で1回だけ進めた側が実行する。**引数は承認待ち・実行中・結果不明の間だけDBに持ち**、確定したら消す（金額・相手先をMorrowに残さない）
- 重複防止は道具ごと。**冪等キー1本を前提にしない**。手段の無い道具は結果不明のとき自動再試行しない
- `dryRun` は確認用の `previewDeleteEvent()` だけが持つ。実行用は `dryRun` を断る
- 通知の種類 `hermes-approval`・チャット画面への組み込みは #794 で実装済み

### DiscordのHermesとの境界（#729。設計のみ）

詳細は `docs/hermes-discord.md`。Discord（default profile）は#728の後も残すが、役割を分ける。`~/.hermes` の変更は人の作業（#762）。

- **Discordで受けるのは、通知の受信・通知へのその場の操作（🗑️🔎・スレッドの追い質問）・開発運用（#アプリ-issue提案・シェル作業）だけ。**
  台帳を触る日常の指示はMorrowへ寄せ、#ヘルメス の自由会話は#728の公開後に止める
- **セッション・記憶は共有しない**（profile分離。#725）。`--clone` は作成時点の `MEMORY.md`・`USER.md` を写すので作成後に空にする。
  cron・ボットトークンは写らない（`--clone-channels` は付けない）
- **端末を鳴らすのはMorrowだけ。** 新着メールはDiscordのミラー（全メール・Hermesの判定）とMorrowの「必要なメール」（#683）で重なるので、
  Discord側の🚨メンションを外し、ミラーは記録として残す。Hermesのチャットの完了・承認待ち（#728）もMorrowのPushだけで知らせる

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
いま使うのは朝の見通し・先回りの提案・話題の仕入れ（お知らせの選定は#663で廃止）。以下はCodexを呼ぶ全経路に共通の事実。

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

- **用途の正は `src/lib/chat-model.ts` の `MODEL_USES` / `MODEL_USE_META` / `DEFAULT_MODELS`。** 3用途
  （朝の見通し・先回りの提案・話題の仕入れ。#574で相談専用の5用途を消した。保存済みの値に
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
天気・予定（AIDE。タスクを含む）・話題を並べる、見るだけの画面（`src/components/dashboard/dashboard-view.tsx`）。
「今日届いた通知」と「届いた通知」（`/pushes`）は#675で廃止した（朝の見通し・先回りの提案とともに）。

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
- **今日以外では「いま」の状態（話題・現在地の天気）を出さない。** 未来の日は届いた通知も出さない。
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
- **雨雲レーダー（#654。`rain-radar.tsx`・純粋な計算は `src/lib/weather/radar.ts`・`test/radar.test.ts`）は「現在地」を開いた中に出す。** 気象庁の高解像度降水ナウキャスト（`www.jma.go.jp/bosai/jmatile`。**公開仕様ではない**）を地理院タイルに重ねる。依存は足していない（`<img>` を並べるだけで、指で地図は動かせない）。**時刻の一覧もタイルもブラウザから直接取る**——相手にはIPとタイル番号（約30km単位）が見えるが、正確な座標は渡さずリファラも送らない。サーバー経由にしないのは、middlewareがタイル1枚ごとにSupabaseへ往復するため。**雨雲タイルが取れなかったコマは赤で知らせる**（空の地図は「雨なし」に見える。#214）。スライダーの行は `data-no-day-swipe` で日めくりから外してある（地図の上のスワイプは従来どおりめくる）。iOSの殻の保存（#643）には地図の `<img>` のURLだけが残り、画像は保存されない
- **雨雲レーダーはナウキャストの先（1時間より後）を降水短時間予報（`rasrf`。#666）で継ぎ足す**（最大約15時間先・1時間刻み・解像度は粗い）。一覧（`jmatile/data/rasrf/targetTimes.json`）は他の製品・解析値も混ざるので `parseLongRangeTimes()` が `rasrf` の予報（`validtime` > `basetime`）だけ採り、同じ時刻は新しい基準時刻を使う。**タイルのURLに一覧の `member`（`none`／`immed`）が入る**（`rainTileUrl()`。`none` 固定にすると404）。取れなかった回はナウキャストの範囲で動き続け、画面に知らせる。Yahoo天気（YOLP）は地点ごとの値だけで地図タイルが無く、appid発行も要るため採らなかった
- **最高・最低気温の前日比**（#665・#679。`src/lib/dashboard/temp-delta.ts`・`test/temp-delta.test.ts`）は、今日以降の日で「(＋3.2)」の形で添える（`WeatherCard` が前日の `dashboardDayWeather()` を引く）。**今日の前日比は今日がAIDE・昨日が自宅地点のOpen-Meteoと、取得元が違う値どうしの差**になる（明日は今日もAIDEなので同一）。系統差が目立つなら今日側もOpen-Meteoで揃える。前日が取れない間（自宅の地点が未取得・取得失敗）は差を出さない（エラー表示にはしない）
- 手元で確かめるときは、上のスタブMCPに `aide_weather`（`location` 付き・無しの両方）と `aide_schedule`（`days` を受ける）を答えさせる
- 手元では、ローカルのスタブMCP（`initialize` と `tools/call` に答えるだけ）を立て、`McpConnection.url` と
  `MCP_PRESETS` の `aide` の `url` を一時的にそちらへ向けて確かめる（**`presets.ts` は戻すこと**）。シードは
  AIDE接続を `enabled: false` で入れるので、そのままでは「未接続」が出る

### 天気ページ（#695）

`/weather` は、登録した地点（自宅は常に先頭）の一覧と地名検索、選んだ地点の**その日の0〜23時**（気温の折れ線・1時間ごとの天気・降水確率・雨量）を出す。
ダッシュボードの「時間と場所ごと」の地点名（予報を取れた区間だけ。場所不明・自宅の地点が未着・日別予報で代用した行は押せない）は、その地点・その日の詳細へ飛ぶ。

- **地点はURLに載る**（`/weather?n=<名前>&lat=&lon=&d=`。組み立て・検証は純粋な `src/lib/weather/place-input.ts`・`test/weather-place-input.test.ts`）。登録していない地点（予定の行き先）も座標だけで開け、登録は詳細のボタン（`POST /api/weather/places`）から。座標は小数2桁に丸めて持つ（外へ送る値と同じ。#586の方針）
- **登録は `WeatherPlace`（利用者ごと・上限8件・座標で一意）。自宅（AIDEの `location`）はDBに持たず**、`dashboardHomePlace()` が先頭へ足す。AIDEが地点を返していない間は自宅の行が出ない
- **検索は市町村まで**（`searchMunicipalities()`。国土地理院の住所検索から `municipalityCandidates()` が市町村の題だけを残す。施設名・番地・海外は引けない）。検索は `GET ?q=`（フォームのGET。JS不要）で、候補は詳細へのリンク
- **気温の折れ線・1時間ごとの帯は `src/components/weather/hourly-strip.tsx` に切り出し、ダッシュボードと共有**している。見た目を変えるときは両方の画面を見ること。1日分は `place-day.ts`（`forecastAt()` の30分キャッシュを使い回すので外への呼び出しは増えない）
- 日付は `?d=`（今日の前後 `DAY_RANGE` 日）。ダッシュボードと違って左右スワイプは持たず、‹ › のリンクでめくる
- **詳細の末尾に雨雲レーダー（`RainRadar`。#756）を出し、地図の中心は選んだ地点。** 部品は現在地（#654）と共有で、地点を変えたら `key` で作り直す。**レーダーは「いま」基準（実況＋約15時間先）なので、今日の表示のときだけ出し**、他の日は一言の注記にする

## 通知の起動（cron）と朝の見通し・先回りの提案の廃止（#675）

**朝の見通し（#79・#183）・朝のニュース・起きた合図（#233）・先回りの提案（#325）は#675で廃止した。** 開いていないときに動く
通知は**定時のお知らせ（#344）だけ**。消したもの: `src/lib/briefing.ts`・`proactive*.ts`・`anthropic.ts`（プロンプト置き場）・
`wake-token.ts`、`POST /api/briefing/wake`、`/api/settings/{proactive,briefing-time,wake-token}`、設定のカード3つ、
モデルの用途「朝の見通し」「先回りの提案」、`User` の `briefingHour/Minute`・`wake*`・`proactive*` 列、ダッシュボードの
「今日届いた通知」と「届いた通知」（`/pushes`。`/c/<ID>`・`/notices` の古い通知のURLは `/` へ転送する）、MCPの `briefingTools`・
`toCodexMcpServers()`。戻すなら履歴（PR #675より前）から拾う。

- **残したもの**: `NotificationLog`（定時のお知らせの二重送信止め。過去の `morning-briefing` 等の行は残るが、どの画面も読まない）、
  `ApiUsage.feature` の `briefing`・`proactive`（過去の記録の名前。`USAGE_FEATURE_LABELS`）、`POST /api/briefing`
  （名前のまま。vpsのcrontabとシークレット `BRIEFING_TRIGGER_TOKEN` を変えずに済むよう、パス・トークン名は据え置き。
  中身は定時のお知らせを `after()` で走らせるだけ）
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

## 共有トークンから認証値を取る（#403）

**`OPS_API_TOKEN`（ops-dashboardから届く）は、
issue-deckの共有トークンAPIから実行時に取る**（`src/lib/shared-token.ts`。共有トークン名も
`OPS_API_TOKEN`。お知らせの受け口の `AIDE_BOT_NOTICE_INGEST_TOKEN` は#663で廃止）。1Passwordからの複製をやめる「方式A」。

- **取れなければ従来の環境変数へフォールバックする**（`sharedTokenOrEnv()`。ただし本番では環境変数をもう配らないので、手元・移行前の環境向け）。キャッシュ10分・タイムアウト5秒・
  失敗時は古くても直前の値。`SHARED_TOKEN_API_SECRET` と `ISSUE_DECK_URL`（deploy.ymlでorganization変数
  `APP_BASE_URL` から渡す）の両方があるときだけ取りに行く
- **フォールバックは画面から見えない。** 本番のデプロイ後は、issue-deckの設定画面で各共有トークンの利用元に
  `aide-bot` が出ることを必ず確かめる（出なければsecret・変数が未登録のままフォールバックしている）。
  取れなかった回は `console.warn` にも残る
- **#570から、環境変数のフォールバックは配らない**（`deploy.yml`・マニフェストから外した）。issue-deckへ
  `OPS_API_TOKEN` が未登録だと `GET /api/ai-usage` が401で閉じる。**そのため `deploy.yml` は、何も送る前に `scripts/check-shared-tokens.sh` で
  読めるか確かめ、読めなければ配布を止める**（#581。404＝未登録、401/403/503＝`SHARED_TOKEN_API_SECRET` の不一致）。
  登録そのもの（issue-deckの設定画面での登録・利用元 `aide-bot` の確認）は人の作業で、#570の手順1。
  **確認用の読み取りも利用元 `aide-bot` として記録される**。`test/check-shared-tokens.test.ts` がスタブで判定を固定する
- 値・Bearerはログに出さない

## お知らせ機能は廃止した（#663）

「いまの一言」・お知らせの一覧（`/notices`）・受け口（`POST /api/notices`・MCPのお知らせ3ツール）・選定（Codex）・急ぎ（URGENT）のPush・
`Notice` テーブル・用途「お知らせの選定」・共有トークン `AIDE_BOT_NOTICE_INGEST_TOKEN` / `NOTICE_INGEST_TOKEN` を消した。トップは
予定（タスクを含む）・天気・話題を見せるだけ。`/notices` は `/` へ転送する（古い通知のURL用。消さない）。
`/api/mcp` に残るのはタスクのツール（`aide_task_*`。`TASK_API_TOKEN`）だけで、未設定なら経路ごと401。

- **残したもの**: `notice-url.ts`（`safeNoticeUrl()`。話題のURL検証と `sw.js` の一致テストが使う）、`NotificationLog` の `urgent-notice`
  （新しくは作らない）、`ApiUsage.feature` の `notice`（過去の記録の名前）
- 戻すなら履歴（PR #663より前）から拾う

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
- **仕入れの起点は、話題画面の「最近の記事を取得する」ボタンと、定時のお知らせの直前（#362）だけ（#660）。仕入れ専用のcronは足さない。**
  以前の「アプリ（ダッシュボード）を開いたとき」の自動仕入れ（`refreshTopicsIfStale()`）は廃止した。ボタンは
  `refreshTopicsNow()`（`POST /api/topics/refresh`。終わるまで待って結果を返す）で、成功後の1時間・失敗後の15分の間隔も
  DB上の最新時刻も見ずに必ず取りに行く（走っている間は `busy`）。定時のお知らせの直前の仕入れは下記
  「定時のお知らせ（#344）」の節。**画面を開いたときに仕入れを戻さないこと。**
  定時の側（間隔あり）は、前回の時刻をプロセス内のMap（`attempts`）に成否を問わず残し、再起動直後だけDBの `fetchedAt`
  を見る——DBだけだと0件・失敗の回で時刻が進まない。
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
  実際の仕入れを手元で通すには、`Topic.fetchedAt` を2時間ほど戻してから 「最近の記事を取得する」ボタン（`POST /api/topics/refresh`）を
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
  `startRefresh()`（手動ボタンの仕入れと同じ入口・同じ `attempts` の錠）を最小間隔30分で呼ぶ
  （`runScheduledPushes()` の先頭で、送信対象の利用者ごとに1回）。
  仕入れ済み・失敗・実行中でも止めず、溜まっている話題で送る。**cron経由でも仕入れが走る**が、1回約30秒〜数分・サブスク枠を使う点は#144のまま
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

## メールの画面と必要なメールのお知らせ（#683）

AIDEのメール受信をMorrowへ移した（aide#795）。**Gmail/IMAPの資格情報と取得処理はAIDEに残し、Morrowは持たない**（`imapflow`・Gmailの資格情報は足さない）。
Morrowのサーバーが AIDEの `/api/mail/*`（契約の正はAIDEのREADME「Morrow向けのメールAPI（#795）」）を叩く。呼び出しは `src/lib/mail/aide-client.ts`、
応答の検証・本人照合は純粋な `contract.ts`（`test/mail-contract.test.ts`）。画面は `/mail`（一覧）・`/mail/<id>`（本文）。

- **認証は共有トークン `AIDE_MAIL_API_TOKEN`**（issue-deck。取れなければ同名の環境変数＝手元のスタブ用）。`scripts/check-shared-tokens.sh` が配布前に
  読めるか確かめる。宛先は既定 `https://aide.gucchii.com`、`AIDE_MAIL_API_URL` で上書きできる（手元のスタブ用）
- **トークンが表すのは「Morrowのサーバー」で利用者ではない。** 応答の `owner` とログイン中の人（cronでは判定する利用者）のメールを `isMailOwner()` で
  必ず照合し、違えば中身を捨てて `not_owner`。一覧・本文・整理・新着確認のすべてが `aide-client.ts` を通る
- **整理の操作はAIDEが変更した後でしか `owner` を返さない**ので、送る前に毎回1通目の本文を引いて照合し、応答の `owner` も事後に照合する。
  **照合の結果をプロセス内に持ち回さない**——手元で、ページとRoute Handlerが別のモジュールを持ち、持ち主が変わった後も古い照合結果で操作が通った
- **`partial`（一部のアカウントが読めない）を「メールが無い」と読ませない。** 一覧は赤い帯で知らせ、新着確認は既読位置（`User.mailCheckedAt`）を進めない
- 本文のHTMLは加工されていないので、`sandbox="allow-popups allow-popups-to-escape-sandbox"`（`allow-scripts`・`allow-same-origin` なし）の
  `iframe srcdoc` に閉じ込め、内側のCSPで外部画像を「画像を表示」まで止める（`mailSrcdoc()`）
- **新着確認（`src/lib/mail/triage.ts`）の起点は、メール専用のcron口 `POST /api/mail/cron`（#768。vpsから2〜3分ごと。認証は`/api/briefing`と同じBearer）・15分ごとの`/api/briefing`の`after()`（重複しても`running`で1本）・画面の「いま確認」（`POST /api/mail/check`。1分あける）。**
  vpsの `cron/crontab.txt` は以前から `*/15` で `scripts/aide-bot-briefing.sh`（`/api/briefing`）を叩いているので、vps側の変更は要らなかった。
  **受信から通知までを速くする方法（間隔の短縮・Gmailのpush通知・IMAP IDLE）の調査は `docs/mail-realtime.md`**（#761。本番のメインはGmail APIで、IMAPは追加アカウントだけ）
- **メインのGmailはpush通知（`users.watch`＋Pub/Sub）でも起こす**（#769。受け口 `POST /api/mail/push`・判定は `checkMailFromPush()`）。OIDCトークンは依存なしで検証し（`gmail-push-core.ts`）、
  **`email` を `GMAIL_PUSH_SERVICE_ACCOUNT` と照合するのが本体**（未設定なら401で閉じる）。cronは取りこぼしの保険で、cronがメインの新着を判定したら「pushで拾えなかった」とログに出す。詳細は `docs/mail-realtime.md`
- 判定はCodex（用途「メールの判定」・機能 `mail`）。**渡すのは差出人・件名・冒頭（snippet。200字で切る）だけ**で、メッセージIDは `m1`…の仮番号にする
  （`triage-core.ts`・`test/mail-triage.test.ts`）。通知の種類がオフ・判定していない新着が無い回はCodexを呼ばない。基準は利用者が書く `User.mailCriteria`（空なら既定）
- **同じメールは二度判定・二度通知しない**（`MailTriage` の利用者×メールID一意）。**ただし必要と判定した行は、通知の試行（`sendPushToUser()`）が終わってから作る**（#693。先に作ると、作成と送信のあいだで止まった回の通知が永久に失われる）。不要・枠あふれの行は先に作る。送信後・確定前に止まった回は、次の確認で再判定されて再通知されうる（取りこぼすより重複を選ぶ。再判定はCodexなので結果は変わりうる）。件名・差出人・本文はMorrowのDBに残さない（`NotificationLog` の本文も件数だけ）。
  初回は既読位置を置くだけで、溜まっている過去分は知らせない。返答が読めなかった回は何も記録せず次でやり直す
- **画面（`/mail`）の一覧だけは短期キャッシュする**（#823。`listMailCached()`・`list-cache.ts`・`test/mail-list-cache.test.ts`）。本文から戻るたびのAIDE取得が遅かったため。利用者×メール×検索条件ごとにプロセス内へ60秒（〜10分は古い値を即返して裏で更新）。**保存は成功かつ `partial` でない結果だけ**、返却時は複製、世代番号で破棄と裏更新の競合を防ぐ。整理操作の成功・「いま確認」で破棄する。**本文・整理操作・新着確認・チャット文脈は従来どおり毎回取得・照合**（一覧の閲覧だけが例外）。件名等はDB・ログに残さない
- **一覧⇔本文の切り替えは `MailTransition`（`mail/layout.tsx`）が付ける**（#699）。パスが変わったときだけ前のパスから向きを決めて滑り込ませ（一覧→本文は右から）、`popstate`（ブラウザの戻る・iOSの端スワイプ）では付けない。待ちは `loading.tsx` のスケルトン（`mail-skeleton.tsx`。一覧の絞り込み・ページ送りでも出す）。本文の画面は本文と判定を並行に取り、ラベル名のための一覧の取得は `Suspense` で後から流す——**本文の表示を一覧の取得で待たせない**
- 開発DBのシードにメールのダミーは無い（メールはAIDEにしか無いため）。手元では、`initialize` 不要の小さなHTTPスタブ（`/api/mail/messages`・
  `/api/mail/messages/<id>`・`/api/mail/actions` に答えるだけ）を立てて `.env.local` の `AIDE_MAIL_API_URL`・`AIDE_MAIL_API_TOKEN` を向け、
  `CODEX_BIN` も判定のJSON配列を返すスタブにして確かめる。「いま確認」の前に `User.mailCheckedAt` を少し戻すと新着として拾われる

### メール通知の学習——印から傾向を読み取る（#833）

基準をまとめて書く代わりに、メール本文の画面の帯（「お知らせ済み」「お知らせしていません」）で「今後このようなメールを［知らせる｜知らせない］」を押して学習させる（`mail-feedback.tsx`・`POST /api/mail/feedback`）。

- **押すたびにCodex（用途「メールの判定」と同じモデル・機能 `mail_learn`）が、押したメールの差出人・件名・冒頭（snippet）と今の傾向一覧から、傾向の文を足す・直す・まとめる**（`learn-core.ts`・`learn.ts`・`test/mail-learn.test.ts`）。**残すのは傾向の文（`User.mailLearnedRules`。最大20件・1件80字）だけで、件名・本文は保存しない**（計画への指摘で「丸ごと記録する案」を採らなかった）。押した印は帯に出すため `MailFeedback`（メッセージIDと向きだけ）に残す
- 傾向は判定のプロンプト（`buildTriagePrompt()` の第3引数）へ、書いた基準の後に「基準より具体的なので従う」として並べる。**DBから読んだ値も `normalizeLearnedRules()` を通してから入れる**（画面の削除・取り消しで送られた値も同じ）
- 返答の一覧が空・読めない回は一覧を変えない（1回の印で全部を失わない）
- Codexは分析・指示と同じ排他（`codex-lock.ts` の `learn`）。**メールを開くとAI分析が自動で走るので、開いた直後に押すと429**（「分析が終わるまで待って」）
- 「取り消す」は `DELETE /api/mail/feedback` に押す前の一覧（`POST` の応答の `previous`）を送り返して戻す。一覧の削除は `PUT /api/mail/learned-rules`（残りを送る）
- 帯は判定していない・不要と判定したメールにも出す（`mailTriageFor()`）

### メール詳細の操作と要約（#717）

- **本文の画面の操作は「既読／未読に戻す」と「アーカイブ（アーカイブ済みなら受信トレイへ戻す）」だけ**（`mail-detail-actions.tsx`）。スター・ラベル・ゴミ箱は使わないので出さない。サーバー側の `star`／`label-*`／`trash`（`aide-client`・`/api/mail/actions`・契約）は一覧が使うので残してある。ラベル名のための一覧取得も詳細からは外した（「処理済み」ラベルの自動付与〔#689〕はサーバー側で一覧を引くので残る）
- **要約は#766で提案と1回のAI呼び出しにまとめた**（下の「メールのAI分析」）。「📝 要約する」ボタン・`POST /api/mail/flow/summary`・`summary.ts`・用途「メールの要約」（`mail_summary`）は消した。`summary-core.ts` には要約の決まりごと（`SUMMARY_RULES`）と返答の検証（`parseSummaryReply()`）だけが残る。使用量の機能名 `mail_summary` は過去の記録の名前としてだけ残す

### メールの提案——AIが処理を推論して他アプリへ流す（#689）

メール本文の画面で、本文をCodex（用途「メールの分析」＝キー `mail_suggest`・機能 `mail_suggest`）に読ませ、おすすめと候補（家計簿・サブスク・タスク・予定。最大3件）を出す。
実行はカードごとに利用者が押したときだけ（自動実行しない）。純粋な部分は `src/lib/mail/suggest-core.ts`（`test/mail-suggest.test.ts`）、サーバーは `suggest.ts`（`applyFlow()`）、口は `/apply`。

### メールのAI分析——開いたら自動で要約と提案、押すとハーフモーダル（#766）

- **開いた時点で自動で `POST /api/mail/flow/analyze` を叩き、要約と提案を1回のCodexで作る**（`analyze-core.ts`・`analyze.ts`・`test/mail-analyze.test.ts`）。以前は「要約する」「このメールをどうする？」の2つのボタンで別々に呼んでいた。プロンプトは `SUMMARY_RULES`・`SUGGEST_KIND_RULES`・`SUGGEST_RULES`・`SUGGEST_EXAMPLE` を並べて組み立て、返答は既存の `parseSummaryReply()`・`parseSuggestReply()` に通す
- **結果は利用者×メールIDで30分だけプロセス内のメモリに持つ**（上限100件。DB・ログには残さない。再起動で消える）。開き直すたびにサブスク枠を使わないため。「↻ 分析し直す」（`refresh: true`）で取り直す。**覚えた結果を返すときも毎回 `getMail()` で持ち主を照合する**
- Codexは利用者ごとに同時1件。同じメールの要求が重なれば走っている1回を共有し、別のメールは429（`busy`）。画面は5秒ごとに取り直す（前のメールの分析は画面を離れても最後まで走り、記憶に入る）
- **提案の行には入力欄を出さない。** 押すと `FlowSheet`（`<dialog>` の `showModal()`。下から出るハーフモーダル。幅560pxまで）に読み取った値を入れて出し、直して登録する（登録の経路は `/apply` のまま。家計簿だけは入力欄を持たずAsset Managerで入力する。#781）。下に記録の持ち主のアプリを開くリンク（`app-links.ts`。DaySpanのタスク・カレンダー、Asset Managerの家計簿連携）を置くが、**入力値は引き継がない**（受け側の口が各アプリに無い）
- 行の「登録済み」は、その画面で登録できた回と、ページが読む控え（`MailFlowRecord`。#750）の `opened` 以外から出す。サブスクの主ボタンは今どおり「一覧を開いた」を控えに残す（登録済みとは出さない）

### メール本文への指示（#784）

- 「AIの分析」カードの末尾の「💬 このメールについて頼む」（`mail-chat.tsx`）から自由な文で頼むと、`POST /api/mail/flow/chat` が本文＋指示＋直近のやり取りでCodexを1回呼び（`chat-core.ts`・`chat.ts`・`test/mail-chat.test.ts`）、返事の文と、必要なら提案の行（分析と同じ形・同じ検証・同じ `/apply`）を返す。モデルは用途「メールの分析」と同じ、使用量の機能は `mail_chat`
- **やり取りはどこにも保存しない**（画面のstateだけ。サーバーも結果を覚えない）。続きの文脈は画面が `history` として毎回送り直すので、`normalizeChatHistory()` が件数・合計の長さを切る（外から来る値。ここを通さずにプロンプトへ入れない）。返事はプレーンテキストで描く
- **Codexは利用者ごとに同時1件で、分析と指示で排他を共有する**（`codex-lock.ts`。鍵に種別）。**結果の共有（同じメールなら走っている1回を返す）は分析側だけ**——共有すると分析中に送った指示が分析の結果を受け取る。分析中は画面が送信を止め、サーバーも `busy`（429）で断る
- **提案の行の状態（登録結果・実行中・開いている行）は行ごとの識別子がキー**（`use-flow-cards.tsx`。分析は `a-<n>`、指示は `c<番号>-<n>`）。種類をキーにすると分析と指示の同じ種類の行が上書きし合う。指示の行の「登録済み」はその行で登録できた回だけ（控えからは出さない。値が分析の行と違いうるため）
- メールの送信・削除・自動登録はしない。Hermes経由（#724の実行窓口）にしていないのは、チャット画面（#728）・subpcの疎通（#738）が未完のためと、#732で「メールのAI推論は窓口に残す」と決めたため

- **本文全体をCodexへ渡す**（新着確認は件名・差出人・冒頭だけ）。開いたメールだけ・6千字まで・DBには保存しない。本文はデータとして読ませ、返答は固定の形で検証する
- **値は承認後にサーバーで検証し直す**（`normalizeSuggestion()`）。読み取れない金額・日付はnullのまま画面で空欄＋「要確認」にし、**推測で埋めない**
- **書き込みは `callWriteToolJson()`（`direct-call.ts`）の許可リスト3本だけ**（`aide_create_task`・`aide_create_event`・`asset_manager_import_payment`）。`callToolJson()` の書き込み拒否は変えていない。**道具を足すときはこのリストと `suggest-core.ts` の検証を揃える**
- **家計簿はMorrowで入力させず、Asset Managerのレシート編集画面で入力する**（#781）。シートは読み取った値（支払先・日時・品目と金額・合計）を見せるだけで入力欄を持たない。主ボタン「Asset Managerで入力する ↗」が `review: true` で**確認待ちのレシート**を作り（分類・信頼度によらず確定も家計簿への登録もしない）、返った `receiptId` の `https://asset.gucchii.com/receipts/<id>` を開く。品目の追加・分割、カテゴリ（AI分類）、メモ、確定はAsset Managerで行う。契約の正は asset-manager#1216（`lib/payment-import.ts`）と aide#832（`asset_manager_import_payment`）
  - **`review: true` なら `place`・`amount` は省ける**（#743の「必須」は確認待ちでない取り込みだけ）。**省けないのは購入日と、名前の手掛かり（`name`・`place`・`items` のどれか）**で、`paymentBlocker()`（`payment-receipt.ts`。画面とサーバーで共有）が欠けを止める。**品目も品名も無ければ支払先を `name` に入れて送る**（Asset Managerは品目が無いと `name` を必須にし、`place` へは落とさない）。AIDEは `additionalProperties: false` なので、無い値は引数ごと外す
  - **品目は `items`（`name`・`amount`＝値引き後の円の整数・`quantity`）**。品目ごとに分類される。合計が `amount` と合わなくても断られない（確認待ちになるだけ）。時刻が本文にあれば `date` を `YYYY-MM-DDTHH:mm` にする（受信日時を使わない）
  - **押した瞬間に空のタブを開き、作り終わってからそこをレシートの画面へ向ける**（後から `window.open` するとポップアップとして止められる）。失敗・idが返らなければ空のタブを閉じる。**iOSの殻は新しいウインドウを作らない**ので、作り終わってから画面ごと移る（殻がAsset Managerアプリへ渡す。#744）。どちらでも開けなかった回のためにシートに「Asset Managerでレシートを開く ↗」を残す
  - 取り込み済みのメールでもう一度押すと `duplicate`＋`receiptId` が返り、同じレシートが開く
- 実行の前に `getMail()` で持ち主を照合する。タスクは同じメール・同じ内容なら同じ `idempotencyKey`、家計簿は `gmailMessageId` で二重取り込みが `duplicate` になる
- 流した後、利用者が作った「処理済み」ラベルがあれば付ける（`DONE_LABEL_NAME`。自動作成しない）
- **サブスク登録（#709）はMorrow内で完結させない。** 提案の種類 `subscription` は、読み取った値（名称・金額・通貨・周期・請求日・開始日だけ。本文・差出人は載せない）をクエリに載せて `https://asset.gucchii.com/subscriptions` を開くリンク（`subscription-link.ts`）で、`asset_manager_create_subscription` は呼ばない。**受け側（クエリで登録フォームを埋める口）は未実装で別Issue**。それまでは一覧が開くだけ **ボタンは「Asset Managerのサブスク一覧を開く」と表記し、登録できたかのように読ませない**（受け側が未実装の間は一覧が開くだけで、入力は引き継がれない。画面にもその旨を添える。#734）。
- **書き込みの失敗理由**: `callWriteToolJson()` の `tools/call` だけ30秒待ち、`isError` の結果は短い `reason` だけを `McpCallError.reason` に載せて画面へ出す（本文・スタックは出さない）。`apply` の `maxDuration` は120秒
- 給与明細→給与台帳（`asset_manager_salary_*`）は入れていない（プレビュー→承認の2段階のため別Issue）

## 通知の種類ごとのオン・オフとテスト送信（#488）

**端末の登録（Web Push購読・APNs）とは別に、利用者単位で「どの種類の通知を受け取るか」を持つ。**
種類は**定時のお知らせ（`scheduled-push`）と必要なメール（`mail-notice`。#683）**で、定義の正は
`src/lib/push/kinds.ts`（`NotificationLog.kind` と同じキー。クライアントからもimportする）。

- **保存は `User.pushDisabledKinds`（オフにした種類のキーをカンマ区切り。空文字＝全部オン）。** 種類ごとに列を
  足さないのは、種類が増えるたびにマイグレーションが要るため。**知らない名前は `parseDisabledKinds()` が捨てる**
  （廃止した種類のキーが残っていても害は無い）。読み出しは `disabledPushKinds()`（`kinds-server.ts`）で、
  読めなかった回は全部オンへ倒す（通知を黙って止めない）
- **止める場所は送信の手前ではなく生成の手前**（定時のお知らせは仕入れの前）。**新しい通知の種類を足すときは `PUSH_KINDS`・`PUSH_KIND_INFO` と、生成の手前の止め処を揃える**
- **「試しに送る」は種類別**（`POST /api/push/test` の `{ kind }`。本文なしは従来の1本）。その種類と同じタイトル・遷移先の
  見本を送り、**種類がオフでも送れる**（確かめたいのは届き方）。モデルは通さない（費用0円）
- 画面は設定の「通知の種類」（`PushKindsCard`）。保存は `PATCH /api/settings/push-kinds`（`{ "<種類>": true|false }`）

## 外部サービスとの接続（MCP）

**#675で朝の見通し・先回りの提案を廃止したので、いまMCPを使うのはダッシュボードの天気・予定（`src/lib/mcp/direct-call.ts` の直接呼び出し）だけ。** Codexへ接続を渡す口（`toCodexMcpServers()`・`briefingTools`）は消した（`runCodexExec()` 側の `mcpServers` 対応は残る）。以下のCodex向けの記述は、戻すときの参考として残してある。

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
#574で相談を廃止し、#675でCodexへ接続を渡す経路そのものが無くなった。ユーザーが選べる許可設定・Cookie・設定画面の選択欄は無い。

- **止め方は `disabled_tools=[…]`**（`toCodexMcpServers()` → `runCodexExec()`。#131）。名指しした
  道具は `tools/list` の結果から落とされ、モデルには見えず `tools/call` も飛ばない
- **止める道具の名前の正は `MCP_PRESETS` の `writeTools`**（`src/lib/mcp/presets.ts`）。名指しで止める形なので、
  **挙げ漏らした道具はそのまま渡る**。接続先が書き込みの道具を増やしたら、ここへ足すまで絞り込みは効かない。
  逆向き（取得系だけを名指しで許す）にしないのは、接続先が取得系を1つ足すたびにこちらを直すまでその道具が
  使えなくなるため。**取りこぼしても壊れない側へ倒してある**ので、「絞り込んだから安全」と見なさないこと
- **Notionの `writeTools` はあえて空にしてある。** 実在する道具名を実物で確かめられないため。

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
  との一致・`readJsonObject()`（#262）・`buildAiUsageReport()` /
  `hasValidBearer()`（`ai-usage-report.ts`・`bearer-auth.ts`。使用量APIの組み立てとBearer検証。#297）・
  `throwIfCodexFailed()`（`codex.ts`。Codexの打ち切り・失敗の文言。#229）。**PrismaやSupabaseへ触れる
  モジュールはimportしない**（テストからDBへ繋がない）。**DBに触れるモジュールの中にある計算を
  テストしたいなら、純粋な関数として別ファイルへ切り出す**。生成物を実行時にimportするだけのものは素のNodeでも読める
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
（1Passwordへの書き込み・本番デプロイの実行はいずれも人の操作）。

1. 1Passwordの `apps` ボールトに `aide-bot` アイテムを作り、`target-dir` / `db-name` /
   `allowed-google-emails` を登録する。値の形は他アプリのアイテムに揃える
   （`target-dir` は `/home/github-user/apps/aide-bot`、`db-name` は `app_aide_bot`）
2. `eval $(op signin)` の後に `scripts/sync-github-secrets.sh --dry-run` → 本実行。
   **個人アカウントで実行する**（サービスアカウントは日次1,000リクエストの共有枠を消費する）
3. `gh api repos/guchi-apps/morrow/actions/secrets --jq .total_count` で登録件数を確かめてから
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
