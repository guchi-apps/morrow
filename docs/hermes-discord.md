# DiscordのHermes AgentとMorrowの境界（#729）

Morrowにチャット（#728）を足した後も、DiscordのHermes Agent（subpc・default profile）は残す。両方から同じ出来事を
二重に通知したり、同じ処理を二重に走らせたりしないための境界を決める。方針は #724（Morrowは利用者が触る唯一の入口）、
Hermesの口とprofileの実測は #725、経路は `docs/hermes-route.md`（#726）、操作の範囲は `docs/hermes-actions.md`（#727）。

**状態: 設計のみ。** Morrowのコードも subpc の `~/.hermes` も変えていない。`~/.hermes` の変更は人の作業（末尾）。

## 結論

| 決めること | 結論 |
|---|---|
| Discordで受け付ける指示 | **通知の受信＋通知へのその場の操作＋開発運用だけ。** 台帳（予定・タスク・家計簿など）を触る日常の指示はMorrowへ寄せる。#ヘルメス の自由会話は#728の公開後に止める |
| セッション・記憶の共有 | **共有しない。** MorrowはMorrow専用profile（`hermes -p morrow`）、Discordはdefault profile。記憶は同期しない |
| 通知の重複 | **端末を鳴らすのはMorrowだけ**（同じ出来事を両方から鳴らさない）。Discordは記録・検索の場として残す。メールのミラーは🚨のメンションを外す |
| gateway側の設定変更 | 要る（下の「`~/.hermes` の変更」）。どれも人の作業 |

いずれも利用者の判断（#729の計画時の回答）。

## Discordで受け付ける指示の範囲

2026-11-08時点のDiscordの使われ方（`~/.hermes/config.yaml` と `channel_directory.json` から）:

- `free_response_channels` が #ヘルメス（home channel）と #アプリ-issue提案。この2つではメンション無しで応答する
- #アプリ-issue提案 は `channel_prompts` で「Issue起案窓口」として動く（開発運用）
- #gmail-* の3チャンネルは、メールのミラー通知の投稿先。通知のスレッドで追い質問（「ガス料金の確定メール来てる？」）をしている

| 区分 | 場所 | #728の後 |
|---|---|---|
| 通知の受信 | #gmail-*・#ai使用量アラート・#ヘルメス-通知 など | **残す** |
| 通知へのその場の操作 | 通知メッセージのリアクション（🗑️ でアーカイブ・🔎 で詳細）、通知のスレッドでの追い質問 | **残す**（通知を読んだその場で済むことはDiscordで完結させる） |
| 開発運用 | #アプリ-issue提案（Issueの起案）、シェル・ファイル作業 | **残す**（#727でMorrowのprofileからシェル・ファイルを外した。Discordのdefault profile側の役割） |
| 日常の指示・相談（台帳を触るもの） | #ヘルメス の自由会話 | **Morrowへ移す。** #728の公開後に `free_response_channels` から #ヘルメス を外す（メンションすれば応答は残る） |

- **境界は「どの場所に書いたか」で決まり、二重応答は構造上起きない。** 1つの発言はDiscordかMorrowのどちらかにしか届かず、
  2つのprofileは別のセッション・別のgateway接続を持つ。Morrowのprofileはボットトークンを持たないので（下記）、Discordへ応答しない
- **同じ指示を両方へ書いた場合は、両方で実行される。** 構造では防げない。台帳への書き込みの重複は、道具の冪等キー
  （タスク・移動の `idempotencyKey`、家計簿の `gmailMessageId`）が受け止める。冪等キーの無い予定の作成・更新は aide#823 で対応中（`hermes-actions.md`）
- #ヘルメス の自由会話を止めるのは#728がMorrowで使えるようになってから（先に止めると、台帳への指示の入口が無くなる）

## セッション・記憶

- **共有しない。** profileは `HERMES_HOME` ごと分かれ、`state.db`・`sessions`・`memories` が別になる（#725で実測）。
  共有すると、Morrow向けに絞った道具（`hermes-actions.md`）とDiscordの広い道具が同じ会話に混ざり、どちらで何をしたかも切り分けられない
- Discordで話したことをMorrowのHermesは覚えていない（逆も同じ）。台帳の事実は台帳（AIDE経由）から引くので、記憶を共有しなくても困らない
- 人格（口調）を揃えたいときは `SOUL.md` を写す。**記憶（`memories/`）は写さない**
- **`hermes profile create morrow --clone` は作成時点の記憶を写す。** 写るのは `config.yaml`・`.env`・`SOUL.md`・`memories/MEMORY.md`・
  `memories/USER.md`・スキル・プラグイン（Hermes v0.22.5 `hermes_cli/profiles.py` の `_CLONE_CONFIG_FILES`・`_CLONE_SUBDIR_FILES`）。
  Discordの会話由来の記憶が初期値として入るので、作成後に `MEMORY.md`・`USER.md` を空にする。手順の正は `hermes-actions.md` の
  「Morrow専用profileの設定」
- **cronとボットトークンは写らない**（`--clone`・`--clone-all` のどちらでも。`_CLONE_ALL_HISTORY_EXCLUDE_ROOT` に `cron`、
  ボットトークン・platformの設定は `clone_channels` を付けない限り除かれる）。複製したprofileが同じcronを二重に走らせたり、
  同じDiscordボットへ繋いだりすることはない。**`--clone-channels` は付けない**

## 通知の出し手と重複

### いまの出し手（2026-11-08）

| 出来事 | Morrow | Discord（Hermesのcron。`hermes cron list`） |
|---|---|---|
| 新着メール | 「必要なメール」だけPush（#683。Codexが判定。15分ごと） | **3アカウントの全メールを各チャンネルへ**（`gmail_{main,formal,sub}_notify.py`・5分ごと）。Hermesが要約と「🚨緊急／📌要対応／対応不要」を付け、**🚨のときだけ本人をメンション** |
| 要対応のメールだけ | 同上 | `gmail_action_triage.py`（#要確認メール）。**10/29から停止中** |
| ニュース | 定時のお知らせ（#344） | なし |
| AIサブスクの残枠 | なし | `ai_subscription_quota_alert.py` |
| 電気・ガスの請求の取り込み | なし | `kepco_bill_auto_import.py`（kurashioへ書き込み、結果をDiscordへ） |
| Hermesのチャット（完了・承認待ち） | #728で足す | 該当なし（Discordの会話はDiscordで返る） |

Hermes以外が投稿するチャンネル（#アプリ-本番リリース・#アプリ-異常通知・#ssl更新通知 など）はこの境界の対象外。

### 重なっているもの: 新着メール

同じメールについて、**判定が2回（HermesとCodex）、端末の通知が2回（Discordの🚨メンションとMorrowのPush）**起きうる。

- **端末を鳴らすのはMorrowの「必要なメール」だけにする。** `gmail_notify_common.py` の `format_notice()`・`deliver()` から
  🚨のメンション（`<@…>` と `allowed_mentions.users`）を外す。ミラーの投稿そのもの・要約・状態の表示・🗑️🔎の操作は残す
  （記録・検索と、アーカイブ連動の削除〔`gmail_archive_notice_sync.py`〕を失わないため）
- #gmail-* チャンネルの通知はスマホのDiscordで切る（メンションを外せば、チャンネルの通知設定を「@メンションのみ」にしておくだけで鳴らない）
- **Discordの判定は表示用として残る。** HermesとCodexは基準が違うので、Discordで「📌要対応」と出たのにMorrowが鳴らない食い違いは残る。
  鳴らすかの正はMorrow（利用者が `User.mailCriteria` で基準を書ける）。Discord側の判定（1回のHermes呼び出し）まで止めるかは後で決める
- **`gmail_action_triage.py` は再開しない。** 役割がMorrowの「必要なメール」と同じ
- メール本体の操作（アーカイブ等）は両方からできるが、Gmailが正なので二重にしても壊れない（同じ状態へ揃うだけ）

### 二重処理になりうるもの: 請求メールの家計簿への取り込み

- Morrowのメールの提案（#689）と、subpcの `billing_mail_import.py`（guchi-apps/subpc の `configs/hermes/scripts/`。**2026-11-08時点でcronに登録されていない**）は、
  どちらも `asset_manager_import_payment` を呼ぶ。両方とも `gmailMessageId` を渡すので、同じメールは2回目が `duplicate` になり、二重登録はされない
- 再びcronへ登録するときは、Morrowの提案で押したメールと重なっても上の冪等キーで止まることを前提にしてよい
- `kepco_bill_auto_import.py`（kurashio）はMorrowに同じ経路が無いので重ならない

### これから足す通知（#728）

- Hermesのチャットの「完了」「承認待ち」はMorrowのPush（#488の種類に足す）だけで知らせ、Discordへは出さない。
  Morrowのprofileはボットトークンを持たないので、Hermes側から誤ってDiscordへ出ることも無い
- 逆に、Discordの会話の完了をMorrowへ通知することはしない

## `~/.hermes` の変更（人の作業）

subpcの `~/.hermes` はエージェントが変えない。メール通知のスクリプト（`gmail_notify_common.py` ほか）は subpc リポジトリに原本が無く、
`~/.hermes/scripts/` にだけある（Discordで頼んでHermesに直させてきたもの）。

1. `gmail_notify_common.py` から🚨のメンションを外す（いつでもよい）
2. スマホのDiscordで #gmail-* の通知を「@メンションのみ」にする
3. #728の公開後、`config.yaml` の `discord.free_response_channels` から #ヘルメス（`1563560396013576243`）を外し、gatewayを再起動する
4. Morrow専用profileの作成（#738）では `--clone` を使い（`--clone-channels` は付けない）、作成後に記憶ファイルを空にする（`hermes-actions.md`）

1〜3は #762 で追跡する。
