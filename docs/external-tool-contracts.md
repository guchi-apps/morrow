# 外部ツール（AIDE MCP等）の契約（#854）

MorrowはAIDEのMCPの道具を呼ぶ。道具の実装は別リポジトリ（`guchi-apps/aide`）にあり、**リリース候補のレビューは固定されたコミットの範囲しか読めない**ので、
契約がこのリポジトリに無いと「確認できない」ことが「確認待ち（要確認）」になってリリースが止まる（RC-31・#850。個別の原因は #853）。
このファイルと `test/external-tool-contracts.test.ts` が、Morrowが呼ぶ道具の**入力の契約**の正（リポジトリ内の根拠）。

## ルール（`CLAUDE.md` にも要約を置く）

外部の道具を呼ぶ処理を足す・変えるときは、**同じPRで次を残す**。

1. 入力の制約（必須・型・範囲・列挙・`additionalProperties`）を `test/external-tool-contracts.test.ts` の `SCHEMAS` へ足し、呼び出し引数が範囲内であることをテストで固定する
2. 応答を読む処理は、実応答の例をテスト（`test/*.test.ts` の「◯◯の契約」）に置き、パーサーがそのまま読めることを確かめる
3. 確かめた日付と方法（実物を読み取りで呼んだ／AIDEの `tools/list`）を、テストのコメントかこのファイルに書く

契約が文章（`CLAUDE.md`）にしか無い・「未確認」と書いてあるまま呼び出しを足さない。

## 呼んでいる道具と契約の置き場

入力定義は2026-11-09にAIDEの `tools/list`（Claude CodeのAIDEコネクタ）から写した。全道具 `additionalProperties: false`。

| 道具 | 呼び出し元 | 引数 | 入力の制約 | 応答の例を置いているテスト（目安。足りない道具は追加する） |
|---|---|---|---|---|
| `aide_schedule`（読み） | `dashboard/aide.ts`・`mail/link.ts`・`mail/suggest.ts` | `{days:3}`／`{days:1,offsetDays}`／`{offsetDays:-7,days:14}`／`{date,days:1}` | `days` 1〜14・`offsetDays` -31〜90・`date`はYYYY-MM-DD | `dashboard-parse`・`mail-link`・`mail-suggest` |
| `aide_weather`（読み） | `dashboard/aide.ts` | なし | 引数なし | `dashboard-parse` |
| `aide_tasks`（読み） | `mail/link.ts`・`hermes/today-context.ts` | `{status:"open",dateField:due/planned/none,limit:100,cursor?}`（link・today。#1212で揃えた） | `status` open/completed/skipped・`limit` 1〜100・`cursor`・`dateField` due/planned/none・`from`・`to`。**`dateField` を省くと `due`（期限のあるタスクだけ）**で、絞り込みは1ページ取得後なので0件でも `hasMore` がある（2026-11-27にYoteiFlowの `api/internal/tasks/route.ts` と実呼び出しで確認。#1211） | `mail-link`「aide_tasks の契約」（#853）・`mail-tracking-task` |
| `aide_get_task`（読み） | `mail/tracking-task-server.ts`（#1211） | `{taskId}` | `taskId` 必須。scopeは `tasks:read`。応答 `{task:{id,title,status,due,planned,memo,version,…}}`（2026-11-27に実呼び出しで確認） | `mail-tracking-task` |
| `aide_update_task`（書き） | `mail/tracking-task-server.ts`（`callTaskMemoWriteToolJson`。#1211） | `{taskId,version,memo}` | `taskId`・`version` 必須・`memo` は2000字まで。**`idempotencyKey` の引数は無い**。版が違えば `{ok:false,kind:"conflict"}`（`isError` は立たない）。成功は `{task:{…}}`。2026-11-27に `tools/list`・AIDEの `src/mcp/tools/tasks.ts`・YoteiFlowの更新APIのソースで確認（書き込みは実物未呼び出し） | `mail-tracking-task`・`external-tool-contracts` |
| `aide_balances`（読み） | `mail/withdrawal.ts` | なし | 引数なし | `mail-withdrawal` |
| `asset_manager_subscriptions`（読み） | `mail/subscription-match.ts`（#884） | `{}` | `name`・`includeEnded`・`includeHistory`（すべて任意）。2026-11-14に `tools/list` と実呼び出し（`name:"JAF"`）で確認。応答の `variableAmount`（金額が毎回変わる契約。真なら `amount` は見込み額で請求額と違ってよい）・`estimateBasis`（`PAYMENTS`/`MANUAL`/null）・`lastPayment`（`{date,amount}`/null）は2026-11-28に asset-manager#1670 の `app/api/subscriptions/route.ts` の差分で確認（AIDEは応答をそのまま返す。実呼び出しでは未確認）。Morrowが読むのは `variableAmount` だけで、無ければ固定として扱う（#1221） | `mail-subscription-match`（実応答の形） |
| `asset_manager_card_withdrawals`（読み） | `mail/withdrawal.ts`（#910） | `{days:62}` | `days` 1〜62（省略で30日）。2026-11-15に guchi-apps/aide#856 のソースと asset-manager#1446 の `route.ts`・サービスで確認（コネクタ未更新のため `tools/list` ではない）。応答は `withdrawals[].{cardId, cardName, bankName, paymentDate, amountJpy, billedAmountJpy, paidAmountJpy, estimatedAmountJpy, source, confirmation.sourceKey}`。asset-manager#1653以降、`amountJpy` は引き落とされる残り（請求額−済み額）で、請求額は `billedAmountJpy`、済み額は `paidAmountJpy`（2026-11-26に asset-manager の `develop` の `lib/ledger-card-withdrawal-service.ts` で確認。実呼び出しでは未確認）。メールの額との比較は `billedAmountJpy`、無ければ `amountJpy`（#1204） | `mail-withdrawal`「カード引き落とし見込みとの突き合わせ」 |
| `asset_manager_confirm_card_withdrawal`（書き） | `mail/withdrawal.ts`（`callCardWithdrawalWriteToolJson`。#910） | `cardId`・`paymentDate`・`amount`・`sourceKey`（冪等キー）・`note` | `paymentDate`・`amount`（0〜1億の整数）・`sourceKey`（191字以内）必須。`cardId` か `cardName`。`additionalProperties:false`。同じ `sourceKey`・同じ中身は `unchanged`、中身違いは409、同じカード・日の別キーは `replaced`（`previousAmountJpy`）。取り消し（見込みへ戻す）の道具はAIDEに無い | `external-tool-contracts`「カード引き落とし見込みの呼び出し」 |
| `kurashio_utility_bill_contracts`・`kurashio_get_utility_bill`（読み） | `mail/utility-bill.ts`（#1100） | `{kind}`／`{kind,contractKey,billingMonth}` | `kind` electricity/gas。`billingMonth` は YYYY-MM（`sourceMessageId` とは同時に指定できない）。OAuthのscopeは `kurashio-bills:read`。2026-11-19に `~/apps/aide` の `src/mcp/tools/kurashio-bills.ts` で確認（契約候補は `{status:"ok",contracts:[{contractKey,planName,latestBillingMonth}]}`、保存済みは `{status:"found",record:{amountYen,usageValue,usageUnit,…}}`／`not_found`）。`found`・`not_found` 以外の応答は照会の失敗として扱う。契約を1つに決められないときは候補すべての行を読み、書かない（#1200） | `mail-utility-bill` |
| `kurashio_import_utility_bill`（書き） | `mail/utility-bill.ts`（`callUtilityBillWriteToolJson`。#1100） | `billingMonth`・`kind`・`contractKey`・`amountYen`・`usageValue`+`usageUnit`・`planName`・`sourceLabel`・`receivedAt`・`sourceMessageId`・`confidence` | `billingMonth`・`kind`・`contractKey`・`sourceMessageId`・`confidence`（0〜1）必須。`amountYen` は0〜100万の整数（無いと `insufficient_data`）。`usageUnit` だけの指定は断られる。**`confirmNewContract` は付けない**（候補に無い契約は `contract_unresolved` で止める）。OAuthのscopeは `kurashio-bills:write`。既存の行は書き換えず、同じ内容は `duplicate`・値違いは `conflict`（訂正の道具は無い）。`conflict`・`contract_unresolved`・`unverified`・`unknown` は `isError` で返る（`McpCallError.status`） | `mail-utility-bill`・`external-tool-contracts` |
| `aide_create_task`（書き） | `mail/suggest.ts`（`callWriteToolJson`） | `title`・`due`・`planned`・`memo`・`idempotencyKey`（`due`/`planned` は `YYYY-MM-DD` か、時刻があるときはタイムゾーン付き `2026-11-20T15:00:00+09:00`。タイムゾーン無しの日時は `invalid`。aide#857・#927。**本番のAIDEが対応してから本番へ出す**） | `title`・`idempotencyKey` 必須 | `mail-suggest` |
| `aide_create_event`（書き） | `mail/suggest.ts` | `title`・`date`・`endDate`・`startTime`+`endTime`・`location`・`calendarId` | `title`・`date` 必須。時刻は両方か両方省略（Morrowは開始だけ読めたら終了を1時間後で補う。#927）。`endDate` は時刻ありの予定だけ。**メモ・説明の引数は無い**（`additionalProperties:false`。2026-11-14に `tools/list` で確認。#908）。`calendarId` は `aide_schedule` の `events[].calendarId` | `mail-suggest` |
| `asset_manager_import_payment`（書き） | `mail/suggest.ts`・Hermesの承認 | `gmailMessageId`・`date`・`confidence`・`review:true` ほか | `gmailMessageId`・`confidence`(0〜1) 必須。`amount` は整数1以上。`review:true` なら `place`・`amount` 省略可。`items` は1〜100件で `name`・`amount` 必須。`usage` は32文字以内の文字列で、`items` があると品名へ足されないので電気・ガス（`250kWh`・`12m3`）は `items` を送らない（#1202） | `mail-suggest`・`mail-utility-bill` |
| `aide_delete_event`（書き） | `hermes`（`previewDeleteEvent`・承認後の実行） | `eventId`・`calendarId`・`title`（確認は `dryRun:true`） | 3項目必須 | `hermes-proposal` |
| `asset_manager_create_subscription` ほかサブスク3本（書き） | Hermesの承認 | Hermesの提案の引数をそのまま検証して渡す | 入力定義は未固定（下記） | `hermes-proposal` |
| `asset_manager_salary_preview`（書き扱い）・`asset_manager_salary_commit`（書き） | `mail/salary.ts`（`callSalaryWriteToolJson`。#1170） | `mailbox`（AIDE応答の `owner`）・`gmailMessageId`・`pdfBase64`（＋commitは `previewId`・`previewToken`） | `mailbox` はメールアドレスの形・255字、`pdfBase64` はデコード後700,000バイトまで・先頭 `%PDF-`。OAuthのscopeは `salary-agent:read`（preview）・`salary-agent:write`（commit）。previewの応答は `{previewId, previewToken, approvalUrl, salaryDate:{year,month,candidate}, lines[], unassignedLabels[], totals:{computed,pdf,difference}, blockers[{code,message}], existing:{alreadyImportedSalaryId,sameDateSalaryId}, canSave}`。パスワード付きは `isError`＋`code:"needs_password"`。commitの成功は `{status:"saved_unverified", registered:true, salaryId}`、`already_registered`・`not_approved`・応答待ち切れの `unknown` は `isError`（`McpCallError.body`）。2026-11-24に `~/apps/aide` の `src/mcp/tools/salary-agent.ts` と asset-manager の `lib/payroll/agent-import-server.ts` のソースで確認（実物は未呼び出し） | `mail-salary`・`external-tool-contracts` |
| `asset_manager_salary_approval_status`・`asset_manager_salary_lookup`（読み） | `mail/salary.ts`（#1170） | `{previewId}`／`{salaryId}` | どちらも `^[A-Za-z0-9_-]{1,64}$`。承認状態は `{status:"ok", previewId, approval: pending/approved/rejected/consumed/expired}`、読み戻しは `{status:"found", salary:{id, salaryDate, grossSalary, netSalary}}`／`not_found` | `mail-salary` |

### Hermesが呼ぶメールの読み取り（#1151・aide#905。Morrowのサーバーは呼ばない）

Hermes（morrow profile）が許可リストで呼ぶ。Morrowの評価のスタブ（`hermes-bridge/eval/stub-aide.ts`）と表示名（`tool-labels.ts`）がこの形に依存するので、`test/external-tool-contracts.test.ts`「Hermesが呼ぶメールの読み取り」が入力と、スタブの応答が形・上限に収まることを固定する。**2026-11-24にaide#905の実装（guchi-apps/aide PR #906・`src/mcp/tools/mail.ts`・README「メールの検索・取得（MCP）」。developへマージ済み）のソースで確認した**（実物は本番反映前で未呼び出し）。

| 道具 | 入力 | 応答 | scope・失敗 |
|---|---|---|---|
| `aide_mail_search` | `query`（必須・1〜200字。Gmailの検索式可、追加アカウント〔IMAP〕は語の全文検索だけ）・`view`（`inbox`/`all`。既定 `all`）・`limit`（1〜20。既定10） | `{partial, failedAccounts[], messages[].{id, from, subject, receivedAt, snippet(200字), unread, inInbox}}`。`receivedAt` はISO8601（UTC）か `null`。ゴミ箱・迷惑メールは対象外。0件は `messages: []` | `mail:read`（無ければ道具の一覧に出ない）。本人記録の無い古いトークン・持ち主でない・取得できないは `isError`（どれも「メールが0件という意味ではありません」を含む文） |
| `aide_mail_get` | `ids`（必須・1〜5件の文字列。重複は1つにまとめる） | `{notice, messages[].{id, from, to, subject, receivedAt, body(1通3,000字), truncated}, missing[]}`。HTMLだけの本文はタグを除いたテキスト。全体12,000字を超えた分は後ろの通から削って `truncated: true`。見つからないidは `missing`（全体は失敗にしない）。添付は返さない | 同上 |

### AIDEのメールAPI（REST。MCPではない）の添付（#1101・aide#867）

`/api/mail/*` の契約の正はAIDEのREADME「Morrow向けのメールAPI（#795）」。#1101でMorrowが読み始めた項目と口は次のとおりで、`test/mail-body-images.test.ts`「添付の契約（aide#867）」が形を固定する。**2026-11-19時点でaide#867は未実装**（Morrowが先に契約を決めて起票した）。AIDEが出るまでは `attachmentId` が無いので、画面はファイル名だけを出す（壊れない）。

- 本文1件の `attachments[]` に `attachmentId`（開き直しても変わらない部品の識別子。英数字・`.`・`-`・`_`、64字まで）・`contentId`（`Content-ID` から `<>` を外した値）・`inline`（埋め込み）
- `GET /api/mail/messages/<id>/attachments/<attachmentId>` → `{ ok, owner, source, filename, mimeType, size, data（base64） }`。25MB超は413 `too_large`。`owner` はMorrowが照合する
- aide#867がマージされたら、実際の応答（Gmail・IMAP）で上の形を確かめ、ここに確認日を書く

### 未固定のもの（わかっている範囲）

- **サブスクの書き込み4本の入力定義**: 引数はHermesの提案から来る。入力の写しをこの表へまだ足していない。足すときは `SCHEMAS` とHermesの提案の検証（`proposal-core.ts`）を揃える（別Issue）
- **応答の形**は道具ごとにテストへ実例を置いている。`aide_schedule`・`aide_weather`・`aide_balances` の応答は `dashboard-parse`・`mail-withdrawal` の例が根拠で、実物の取得日はテストごとに書く

## 契約が変わったことに気付く（手動の確認手順）

CIから実AIDEを呼ぶにはトークンが要るので、自動化はしない（要るなら別途判断）。AIDEが道具を変えた・増やしたと分かったとき、またはMorrowの呼び出しを変えたとき:

1. AIDEのコネクタ（Claude Code）から `tools/list` 相当で入力定義を確かめる（読み取りの道具は実際に1回呼んでよい。**書き込みの道具は呼ばない**・`dryRun` があるものだけ `dryRun:true`）
2. 表とテストの `SCHEMAS` を揃える
3. `docs/hermes-actions.md` の道具の分類表・`MCP_PRESETS` の `readTools`／`writeTools` も揃える

## レビュー側（issue-deck）

未確認範囲を「要確認」ではなく注記にとどめる／外部契約を固定して渡す、というレビューの仕様は `guchi-apps/issue-deck` の領分。Morrow側ではこのファイルとテストで根拠を置くところまでを担う。
