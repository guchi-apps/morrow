# メールを受信したタイミングで取得する方法の調査（#761）

「Gmailのアプリのように、メールが来たらすぐ反映させられないか」の調査結果。**B（Gmailのpush通知）のMorrow側の受け口は#769で実装した**（下の「Bの実装（#769）」）。

## いまの仕組みと、遅れている箇所

| 対象 | 取得のしかた | 遅れ |
|---|---|---|
| メール画面（`/mail`） | 開くたびにMorrowのサーバー→AIDEの `/api/mail/*` →Gmail API／IMAPを叩く（キャッシュなし） | **遅れない**（開いた時点の最新） |
| 必要なメールのお知らせ（Push通知。#683） | 15分ごとのcron（vpsの `*/15` → `/api/briefing` の `after()` → `runMailChecks()`）と、画面の「いま確認」 | **最大15分**＋判定（Codex）の時間 |

- **本番のメインの取得元はIMAPではなくGmail API**（AIDEの `AIDE_GMAIL_INBOX_REFRESH_TOKEN`。`gmail.modify`）。IMAPを使っているのは追加アカウント（`AIDE_MAIL_ACCOUNTS`。#794）だけ。2026-11-08にAIDEのsecret一覧で確認した（`AIDE_MAIL_SOURCE` 変数は未設定＝Gmailのトークンがあるので既定でGmail）
- したがって「リアルタイムにしたい」の中身は**通知までの遅れ**。画面の一覧は今でもその場で取っている
- 通知はCodexで「必要か」を判定してから送るので、受信を即座に知れても、届くまでには判定の時間が乗る（Gmailアプリが速いのは判定を挟まないため）。判定時間の実測はまだ無い

## 選択肢

### A. 確認の間隔を縮める（ポーリングのまま）

メール専用の起動口 `POST /api/mail/cron`（#768で実装。認証は `/api/briefing` と同じBearer。`/api/briefing` 側の確認は`running`で重複しても害が無いので残す）を足し、vpsのcrontabから2〜5分ごとに叩く。`/api/briefing` 自体の間隔は変えない（定時のお知らせなど他の処理を巻き込まない）。

- 遅れ: 最大で間隔ぶん（2分なら最大2分）＋判定時間
- **Gmailも追加のIMAPアカウントも同じ仕組みで速くなる**
- 費用: 新着が無い回はCodexを呼ばない（`triage.ts` の手順4）ので、増えるのはAIDE→Gmail API の一覧取得とIMAPのログインだけ。Gmail APIの割り当てに対しては無視できる量。IMAPは間隔×アカウント数だけログインが増えるので、プロバイダの制限に掛からないよう1分より短くはしない
- 変更範囲: Morrow（起動口1本）＋vps（crontab 1行）。外部サービスの設定は不要

### B. Gmailのpush通知（`users.watch`＋Cloud Pub/Sub）

Gmail APIの公式の「変更があったら知らせる」仕組み。

1. GCP（GmailのOAuthクライアントのプロジェクト）でPub/Subのトピックを作り、`gmail-api-push@system.gserviceaccount.com` に発行権限を付ける
2. AIDEがGmailの資格情報で `users.watch`（`labelIds: ["INBOX"]`）を呼ぶ。**期限は7日なので毎日かけ直す**（AIDEのworker/cron）
3. Pub/Subのpushサブスクリプションが、受信のたびにHTTPSの受け口へPOSTする。中身は `emailAddress` と `historyId` だけ（件名・本文は来ない）
4. 受け口はOIDCトークン（Pub/Subが付けるGoogle署名のJWT）を検証し、該当する利用者の `checkMailForUser()` を起こす（同時実行は既存の `running` で1本に絞られる）

- 遅れ: 数秒＋判定時間
- **対象はGmail APIで読んでいるメインのアカウントだけ。** 追加のIMAPアカウントには効かない（A か C と併用する）
- 受け口の置き場: watchのかけ直しはGmailの資格情報を持つAIDEにしか置けない。pushの受け口は、判定するMorrowに直接置く案（中身に秘密が無く、AIDE→Morrowの新しい経路が要らない）と、AIDEで受けてMorrowへ転送する案がある。#724の役割分担（取得はハブ）に寄せるならAIDE受け
- 費用: Pub/Subは月10GiBまで無料枠で、通知1件は数百バイトなので実質0円
- 手作業: GCPでのトピック・サブスクリプション・サービスアカウントの作成（人の操作）
- 依存: JWTの検証は `node:crypto`（JWKからの公開鍵）で書けるので、パッケージは増やさずに済む見込み
- 注意: Gmail側の通知は「1ユーザーあたり毎秒1件まで」で、超えた分は落ちる。取りこぼしの保険として A の定期確認は残す

### C. IMAPのIDLE（追加アカウント向け）

IMAPの `IDLE` で接続を張り続け、新着が来たらサーバーから知らせてもらう（AIDEの `imapflow` は対応している）。

- 遅れ: 数秒＋判定時間
- **AIDEに常駐プロセスが要る。** AIDEの方針は「接続は1回の表示・操作ごとに開いて閉じ、常駐させない」（AIDEのREADME #782）なので、方針の変更になる。アカウントごとに接続を1本持ち続け、切断（Gmailは約29分ごとなど）からの張り直しも要る
- 追加アカウントの数（最大5）だけ常駐接続が増える

## 推奨

1. **まず A（2〜3分ごと）を入れる。** 変更が小さく、全アカウントに効き、外部の設定も要らない。体感の「15分待つ」はこれでほぼ解消する
2. メインのGmailで秒単位が欲しくなったら **B を追加する**（A は取りこぼしの保険として残す）
3. **C は見送り。** 常駐させない方針を変えるほどの差が、追加アカウントに対しては無い。必要になったら改めて判断する

後続: A は #768、B は #769 で起票した。

## Bの実装（#769）

#769で決めたこと: **受け口はMorrowに直接置く**（中身に秘密が無く、AIDE→Morrowの経路が要らない）。**JWTの検証は依存なし**（`node:crypto`）。

- 受け口は `POST /api/mail/push`（`src/app/api/mail/push/route.ts`）。Pub/SubのOIDCトークンを `verifyPushToken()`（`src/lib/mail/gmail-push-core.ts`）で検証する。
  署名（RS256。Googleの公開鍵は `google-jwks.ts` が `Cache-Control` の間だけ持ち回し、知らない `kid` のときだけ1分に1回まで取り直す）・
  `iss`・`aud`（`GMAIL_PUSH_AUDIENCE`。既定は本番URL）・`exp`/`iat`（5分のずれを許す）・`email`（`GMAIL_PUSH_SERVICE_ACCOUNT`。確認済み）を見る。
  **誰でもGoogle署名のIDトークンを任意の `aud` で作れるので、`email` の照合が本体。** `GMAIL_PUSH_SERVICE_ACCOUNT` が未設定なら401で閉じる
- 認証を通った後は判定を `after()` で起こしてすぐ204を返す（Pub/Subは既定10秒で打ち切って再送する）。読めない本文も204で捨てる（2xx以外は再送され続ける）
- 判定は `checkMailFromPush()`（`triage.ts`）。`emailAddress` と一致する利用者（いなければcronと同じ対象の全員。持ち主の照合は `listMail()`）の
  `checkMailForUser()` を起こす。**判定中に届いた通知は捨てずに、終わってからもう1回だけ確かめる**（`rerunRequested`。重なった通知は1回にまとまる）
- **黙って止まらないための見張り**: push通知を設定している環境で、15分ごとのcronがメインのアカウント（IDの接頭辞が無いか `main~`）の新着を判定したら
  「pushで拾えなかった」と `console.warn` に残す（`warnIfPushMissed()`）。pushが届いていればその場で判定済みになり、cronの回には残らないため。
  再起動の直後・判定の途中で止まった回にも出うる
- `historyId` は使っていない（ログに出すだけ）。差分は従来どおり既読位置（`User.mailCheckedAt`）と `MailTriage` で取る

### Morrowの外に残っている作業

- ~~**GCP（GmailのOAuthクライアントのプロジェクト）での設定**~~（済み。#778）: Pub/Subのトピック作成と `gmail-api-push@system.gserviceaccount.com` への発行権限、
  pushサブスクリプション（エンドポイント `https://aide-bot.gucchii.com/api/mail/push`・認証を有効にしてpush用のサービスアカウントとオーディエンスを指定）
- ~~**`GMAIL_PUSH_SERVICE_ACCOUNT` を本番の `.env` へ届ける**~~（済み。#826。`deploy.yml` の「Send environment variables」に平文で持つ。秘密ではない）
- **AIDEの `users.watch`（受信トレイ）と毎日のかけ直し・失敗のログ**（guchi-apps/aide側）

手元では、`.env.local` に `GMAIL_PUSH_SERVICE_ACCOUNT` を入れて自前の鍵で署名したトークンを送ると、実際のGoogleの公開鍵を取りに行って `unknown_key` で401になる（ログに理由が出る）。
署名の通る経路は `test/gmail-push.test.ts` が自前の鍵で確かめている。
