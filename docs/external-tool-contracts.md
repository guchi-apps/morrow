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
| `aide_tasks`（読み） | `mail/link.ts` | `{status:"open",limit:60}` | `status` open/completed/skipped・`limit` 1〜100・`cursor`・`dateField` due/planned/none・`from`・`to` | `mail-link`「aide_tasks の契約」（#853） |
| `aide_balances`（読み） | `mail/withdrawal.ts` | なし | 引数なし | `mail-withdrawal` |
| `aide_create_task`（書き） | `mail/suggest.ts`（`callWriteToolJson`） | `title`・`due`・`memo`・`idempotencyKey` | `title`・`idempotencyKey` 必須 | `mail-suggest` |
| `aide_create_event`（書き） | `mail/suggest.ts` | `title`・`date`・`startTime`+`endTime`・`location` | `title`・`date` 必須。時刻は両方か両方省略 | `mail-suggest` |
| `asset_manager_import_payment`（書き） | `mail/suggest.ts`・Hermesの承認 | `gmailMessageId`・`date`・`confidence`・`review:true` ほか | `gmailMessageId`・`confidence`(0〜1) 必須。`amount` は整数1以上。`review:true` なら `place`・`amount` 省略可。`items` は1〜100件で `name`・`amount` 必須 | `mail-suggest` |
| `aide_delete_event`（書き） | `hermes`（`previewDeleteEvent`・承認後の実行） | `eventId`・`calendarId`・`title`（確認は `dryRun:true`） | 3項目必須 | `hermes-proposal` |
| `asset_manager_create_subscription` ほかサブスク3本（書き） | Hermesの承認 | Hermesの提案の引数をそのまま検証して渡す | 入力定義は未固定（下記） | `hermes-proposal` |

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
