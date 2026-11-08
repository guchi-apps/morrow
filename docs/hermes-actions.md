# Hermes Agentに任せる操作の範囲と承認（#727）

Morrowのチャット（#728）からHermes Agent（subpc）へ指示したとき、どの操作を自動で進め、どれを人の承認に回すかの設計。
方針は #724（Morrowは窓口・Hermesは実行役・台帳の書き換えはハブ〔AIDE〕経由）、経路は `docs/hermes-route.md`（#726）、
Hermesの口の実測は #725 のコメント。

**状態: 提案の受け口・承認待ちの行・実行API・確認カード部品は #748 で実装済み。** ブリッジ（#737）とチャット画面（#728）、profileの設定は未実装（末尾の後続）。

### 実装の置き場（#748）

- 純粋な部分（検証・引数組み立て・結果の読み替え・伝言）: `src/lib/hermes/proposal-core.ts`（`test/hermes-proposal.test.ts`）。サーバー側: `proposals.ts`
- テーブル `HermesProposal`（承認待ち・記録）・`HermesActionLog`（自動の書き込みの成否）。画面側は `GET /api/hermes/proposals`・`POST …/[id]/execute|cancel`・`src/components/hermes/proposal-card.tsx`
- #737・#728は `ingestStreamToolStart()`（`tool.start`）・`recordAutoAction()`（`tool.complete`）・`pendingHermesNotes()` / `markNotesReported()`（次の発言の先頭）を呼ぶ
- 状態は `pending`・`executing`・`done`・`cancelled`・`expired`・`failed` と、**`unknown`（結果不明）**。引数は承認待ち・実行中・結果不明の間だけ持ち、確定で消す
- **重複防止は道具ごとに違うので、冪等キー1本では揃えない。** 家計簿＝`gmailMessageId`必須（無ければ要確認で実行不可）・予定削除＝`title`一致・サブスク登録＝`duplicateCandidates`。この3つだけ結果不明のとき同じ入力で再試行する。料金改定・契約更新・解約の記録は手段が無いので自動では再試行せず、利用者に確かめさせる（`RETRY_SAFE`）。`idempotencyKey` 列には `morrow-hermes-<提案ID>` を持つが、どの道具の引数にも渡していない（AIDEの入力定義に無い）
- 予定削除は提案を取り込む時点で `previewDeleteEvent()`（`dryRun: true` をリテラル固定）で実物を引く。取れなければ実行させない
- **未実測**: MCPの道具の `tool.start` に引数が丸ごと載るか。載らない場合の経路（ブリッジが呼び出しを受けた時点で流す）は #737 で決める。`update_subscription` の `endDate`／`memo` を null にして消す操作と、`labels` の置き換えは取り込まない
- 期限切れ・実行中のまま止まった行の結果不明化・90日の削除は `/api/briefing` の `after()`（`sweepProposals()`）

## 結論

| 区分 | 扱い | 担保するもの |
|---|---|---|
| 読み取り | **自動** | — |
| 取り消せる書き込み | **自動**（チャットで明示的に頼んだ時点を承認とみなす）。実行後に結果カードを出す | Morrow専用profileの道具の許可リスト |
| 取り消せない書き込み | **Hermesには実行させない。** Hermesは「提案」だけを出し、利用者がMorrowの確認カードで値を見て押したときに、**Morrowのサーバーが**許可リストの道具で実行する | 許可リストから外す（呼べない）＋Morrowのサーバーでの再検証 |
| 対象外 | Morrowのprofileでは呼べないようにする | 許可リストから外す |

- 「書き込みは取り消せるものだけ自動」は利用者の判断（#727の計画時の回答。全部承認・作成だけ自動の案は採らなかった）
- **Hermesの承認の仕組みには、取り消せない書き込みの確認を任せない。** 理由は次の節

## なぜHermesの承認に任せないのか（実装の読み取り）

Hermes v0.22.5（`bf0203a794`）の読み取り。2026-11-08。

1. **MCPの道具の承認は道具名しか見せない。** `mcp_servers.<名前>.trust: untrusted` にすると、`readOnlyHint: true` を宣言していない
   道具の呼び出しごとに承認が出る（`tools/mcp_tool_handlers.py` の `_trust_gate_check()`）。ところが承認に載る文は
   「MCP tool '<道具名>' on UNTRUSTED server '<サーバー>' wants to run.」だけで、**引数（金額・日付・どの予定か）が入らない**
   （`_ask_for_call()`。`approval` リクエストの `pattern_key` は `mcp_elicitation`）。値を見ずに押す承認は、取り消せない操作の確認にならない
   - `tool.start`（引数つき）が承認より先に届けば画面で補えるが、順序は**未実測**。また補えても、承認後にモデルが値を変えて呼び直す余地は残る
2. **AIDEの道具は `readOnlyHint` を宣言していない**（`guchi-apps/aide` の `src/mcp` に `annotations` が無い。`4c0bb00` 時点）。
   `trust: untrusted` にすると**読み取りまで毎回承認**になる（宣言が無いものは書き込みとみなす＝安全側）
3. 承認待ちの上限は `approvals.timeout`（既定300秒）。チャットを閉じている間の承認に向かない

このため取り消せない書き込みは、#689（メールの提案）と同じ「提案 → 値を見せて確認 → サーバーが検証して実行」に寄せる。

## 操作の分類（AIDEのMCPの道具）

Hermesが台帳へ触れる経路はAIDEのMCP（`https://aide.gucchii.com/mcp`）だけ（#724）。道具の一覧は本番のAIDE（2026-11-08）から取った。
**AIDEが道具を増やしたら、ここと許可リスト（`tools.include`）を揃える。** 許可リスト方式なので、足し忘れた道具は「呼べない」側に倒れる。

### 読み取り（自動）

`aide_schedule`・`aide_tasks`・`aide_get_task`・`aide_get_travel`・`aide_weather`・`aide_current_location`・`aide_garbage_collection`・
`aide_balances`・`aide_fixed_costs`・`aide_utility_bills`・`aide_room_sensors`・`aide_room_buttons`・`aide_aircon_status`・`aide_printer_status`・
`aide_work_reports`・`asset_manager_subscriptions`・`asset_manager_salary_lookup`・`kurashio_get_utility_bill`・`kurashio_get_kepco_hourly`・
`kurashio_utility_bill_contracts`・`aide_ping`・`aide_connection_permissions`

- 運用・開発の状態（`aide_host_status`・`aide_vps_memory`・`aide_uptime_monitors`・`aide_service_quotas`・`aide_dev_status`・`aide_repo_status`・
  `aide_repo_labels`・`aide_claude_sessions`・`aide_issue_deck_items`・`aide_issue_deck_summary`）も読み取りだが、Morrowの窓口の用途に無いので
  **初めは入れない**（要るようになったら足す）

### 取り消せる書き込み（自動・結果カード）

| 道具 | 取り消し方 | 二重実行の防止 |
|---|---|---|
| `aide_create_task` | 完了・スキップ（または画面で削除） | `idempotencyKey`（AIDE側で必須） |
| `aide_update_task` | もう一度更新（前の値は直前の `aide_get_task` の結果にある） | `version`（409）＋`idempotencyKey` |
| `aide_complete_task`・`aide_reopen_task`・`aide_skip_task`・`aide_unskip_task` | 対になる道具 | `idempotencyKey` |
| `aide_create_travel` | DaySpanの画面で削除 | `idempotencyKey`・`duplicate` |
| `aide_create_event` | `aide_delete_event`（承認つき）・画面 | **無い**（下の「二重実行」） |
| `aide_update_event` | もう一度更新（下の注） | **無い** |
| `aide_create_issue` | GitHubでclose | 無い（重複は内容で見る） |
| `aide_aircon_control` | 逆の操作 | 状態の指定なので重ねても同じ |

- **予定の更新を「取り消せる」とする根拠**: `aide_update_event` が変えられる項目（タイトル・日付・終了日・時刻・終日・場所・仮/確定）は
  すべて同じ道具で設定し直せる。更新の前に `aide_schedule` で対象を引く決まり（道具の説明文）なので、前の値はHermesの会話に残る。
  繰り返しの親（シリーズ全体）はDaySpanが409で断るので、1回分を超えて広がらない。説明文の「変更前に復唱して確認を取る」は、
  チャットの中の復唱と利用者の返事で満たす（Morrowのカードは挟まない）。**DaySpan側で前の値に戻せない項目が増えたら、承認側へ移す**
- 結果カードには、ストリームの `tool.start` の引数（何をどう変えたか）をその場で出す。Morrowの記録には値を残さない（「実行の記録」）

### Hermes組み込みの道具（#814）

AIDEの道具ではなく、Hermes自身が持つ。チャットのチップに日本語名で出す（`tool-labels.ts` の `BUILTIN_LABELS`。2026-11-08にmorrow profileの履歴で確認）。台帳は触らないので自動書き込みには含めない。

| 道具 | 表示 | 手掛かり |
|---|---|---|
| `web_search` | ウェブを検索 | 検索語 |
| `web_extract` | ページを読み込む | ドメインだけ（パス・クエリは出さない） |
| `tool_search` | 使える道具を探す | 探した語 |
| `tool_describe` | 道具の使い方を確認 | なし |
| `desktop_project` | プロジェクトを確認 | なし |
| `tool_call` | 呼び先の道具の名前で表示 | 呼び先が知らない道具ならその名前 |

知らない道具は「その他の操作」＋道具の名前を灰色で添える。

### 取り消せない書き込み（Morrowの確認カード → Morrowが実行）

| 道具 | 取り消せない理由 | 二重実行の防止 |
|---|---|---|
| `aide_delete_event` | この経路から元に戻せない（説明文に明記）。`dryRun: true` で「何を消すか」を引ける | 消えた予定は消せない（`title` 一致が条件） |
| `asset_manager_import_payment` | 家計簿の登録。この経路から消せない | `gmailMessageId`（同じ値は `duplicate`）。**メール由来の支出だけ**が対象で、メールの画面（#689）と同じ |
| `asset_manager_create_subscription` | 削除の道具が無い | `duplicateCandidates` を返す |
| `asset_manager_add_subscription_price`・`asset_manager_update_subscription`・`asset_manager_record_subscription_cancellation` | 金額・契約の台帳で、前の状態を道具から戻せない（解約の取り消しだけは更新で戻せるが、台帳の扱いを揃える） | 無い |

- **お金・契約の台帳（asset-manager）は、取り消しの道具があっても承認に寄せる**（間違えたときの実害が大きい）

### 対象外（Morrowのprofileでは呼べない）

| 道具 | 理由 |
|---|---|
| `aide_zaim_payment`・`aide_zaim_master` | 廃止済み（Zaim APIの提供終了） |
| `asset_manager_salary_preview`・`_commit`・`_approval_status` | 独自の2段階承認がある。メールの提案でも入れていない（#689）。要るなら別Issue |
| `kurashio_import_utility_bill`・`kurashio_import_kepco_hourly` | 明細の取り込み（PDF・CSV）で、チャットの指示から作る値ではない |
| `aide_room_press` | 押すボタンの効果が道具から分からない（物理操作）。要るならボタンごとに分類して足す |
| `aide_create_notification`・`aide_create_task_candidate`・`aide_save_daily_brief`・`aide_report_work`・`aide_research_desk_import_weekly_report` | 他のエージェント・自動処理のための口。窓口からの指示で使う用途が無い |
| `issue_deck_*`（修正の引き受け・解放・レビュー結果の報告・画像） | 開発運用（Claude Code・issue-deckの領域）。Discord側の用途 |

### Hermes自身の道具（シェル・ファイル・ブラウザなど）

Morrowのprofileでは**持たせない**（`platform_toolsets` から外す）。Morrowの窓口は「AIDE経由で台帳を操作する」ことだけを任せる（#724）。
シェル・ファイル操作はDiscord（default profile）側に残る。持たせないので、Hermesの危険なコマンドの承認（`approval`）は原則として届かない。

### `src/lib/mcp/presets.ts` の `writeTools` との関係

`MCP_PRESETS` の `writeTools`・`readTools` は、**Morrow自身がAIDEを呼ぶ経路（ダッシュボードの直接呼び出し・以前のCodex）で書き込みを一切渡さない**
ための表で、「取り消せるか」で分けたものではない（`aide_create_event`・`aide_aircon_control` も入っている。直前のコメントの「取り消しは元に戻せない」は
`aide_update_event`・`aide_delete_event` を足したときの注記）。**Hermesに任せる範囲の正はこの文書**で、`presets.ts` はMorrow自身の経路の正のまま
変えない。`readTools` に無い `aide_tasks`・`aide_get_task` などは、Morrow自身の経路で使っていないだけ。

## Morrow専用profileの設定（`hermes -p morrow`）

#725・#726の結論どおりMorrow専用profileに分け、道具をprofileで絞る（`serve` にはセッション単位の絞り込みが無い。#725）。
**ここに書く値が保証の本体。** Morrowが送る指示文（「〜はしないで」）は保証にならない（#725）。

| 設定 | 値 | 理由 |
|---|---|---|
| `mcp_servers.aide.tools.include` | 上の「読み取り」＋「取り消せる書き込み」の道具名 | 許可リスト。取り消せない書き込み・対象外は登録されず、モデルに見えない |
| `mcp_servers.aide.trust` | `full`（既定） | `untrusted` にすると読み取りまで毎回承認になる（上記2）。許可リストで代える |
| `platform_toolsets`（`serve` のセッションが読むplatformの項目） | MCPと `web` だけ。シェル（`terminal`）・ファイル・ブラウザ・コード実行・委任（`delegation`）を外す | 台帳以外を書き換えない。**toolsetの正確な名前と、`serve` のセッションがどのplatformの項目を読むかは未確認**（defaultの設定は `cli`・`discord` などplatformごとに `hermes-<platform>` を持つ）。profile作成時に `hermes tools` と `-t web` の実測（#725）で確かめる |
| `approvals.mode` | 既定（`smart`）のまま | 上の絞り込みで危険なコマンドの道具を持たないため。万一届いた承認はブリッジが下記の扱いをする |
| `approvals.timeout` | 300（既定） | ブリッジの1ターン10分（#726）に収まる |
| `command_allowlist` | 空 | defaultの許可（`execute_code` 等）を `--clone` で持ち込まない |

- `--clone` で作るとdefaultの `command_allowlist`・MCPの設定を写すので、作った後に上の値へ直す（#738の手作業）
- **`--clone` で写るもの**（Hermes v0.22.5 `hermes_cli/profiles.py`。#729）: `config.yaml`・`.env`・`SOUL.md`・`memories/MEMORY.md`・`memories/USER.md`・
  スキル・プラグイン。**写らないもの**: cron（`jobs.json`）・セッション（`state.db`・`sessions`）・Discord/Slackのボットトークンとplatformの設定
  （`--clone-channels` を付けない限り）。**`--clone-channels` は付けない**（付けると同じDiscordボットへ繋ぎ、二重に応答する）
- **作成後に `memories/MEMORY.md`・`memories/USER.md` を空にする。** Discordの会話由来の記憶が初期値として入り、以後は同期されない
  （記憶は共有しない。`docs/hermes-discord.md`）。口調を揃えるための `SOUL.md` は残してよい
- 提案用の道具（次の節）を受け持つMCPサーバーをもう1つ足す

## 取り消せない書き込みの提案と確認

### 流れ

1. 利用者「このメールの請求をサブスクに登録して」
2. Hermesは道具を持たないので、**提案用の道具 `morrow_propose_action`** を `{ tool, args, summary }` で呼ぶ
   - 道具の結果は「提案を出しました。利用者の確認を待っています。実行済みとは言わないこと」の固定文
3. Morrowは同じターンのストリームでこの呼び出し（`tool.start` の `name`・`args`）を受け取り、**道具ごとの検証**（#689の
   `normalizeSuggestion()` と同じ考え方。読めない値は推測で埋めず空欄＋要確認）を通して「承認待ち」の行を作り、確認カードを出す
4. 利用者がカードで値を見て（必要なら直して）「実行」→ Morrowのサーバーが**もう一度検証し**、許可リストの道具をAIDEへ直接呼ぶ
   （`callWriteToolJson()`。`src/lib/mcp/direct-call.ts` の許可リストを広げる）
5. 結果をカードに出す。Hermesの会話には、次の発言の先頭に「（Morrow: 提案〈要約〉を実行しました／取り下げました）」を付けて伝える

- **提案の受け取りはストリームで行い、Morrowへの受け口を増やさない。** `morrow_propose_action` を答えるMCPサーバーはブリッジ（subpcの
  ループバック）に置く何もしない道具で、Morrowは `tool.start` の引数から提案を読む。どの利用者・どの会話の提案かはストリームで決まるので、
  外から叩ける受け口（と、その認証・利用者の照合）が要らない
  - 前提の確認が要る: MCPの道具の `tool.start` に引数が丸ごと載ること（#725ではシェルの道具で確かめただけ）。載らなければ、
    ブリッジが道具の呼び出しを受けた時点で、そのセッションの実行中ターン（1セッション1ターン。#726）へ紐づけて流す
  - Morrowの `/api/mcp` に提案の道具を置く案は採らない。subpcからVPSへの逆向きの受け口と、提案がどの利用者のものかの照合が要る
- **Morrowが実行してよい道具は、上の「取り消せない書き込み」の表だけ。** 提案の `tool` が表に無ければ提案ごと捨てる（カードを出さない）
- Hermesに提案の道具の使い方（いつ呼ぶか・実行済みと言わない）を教えるのはprofileの `SOUL.md`／道具の説明文。守らなくても実行はされない（保証は許可リスト）

### 確認カード

- **チャットの中に出す**（#728）。道具ごとに日本語の項目名で値を並べる（金額・通貨・日付・対象の予定のタイトルと日時など）。`aide_delete_event` は
  Morrowが先に `dryRun: true` を呼び、消える予定の実物を見せる
- ボタンは「実行」「やめる」の2つ。値の手直しはカード内で行い、直した値もサーバーで検証し直す
- 通知（Web Push・APNs）は「確認待ちがあります」と**チャットを開くだけ**。通知の操作ボタンから直接承認しない（値を見ずに押せてしまう）。
  通知の種類は #488 の仕組みに足す（#728）
- Hermesの `approval` リクエストが届いた場合（道具を絞っているので通常は来ない）も同じカードで「1回だけ許可」「拒否」を出す。
  **`session`・`always` は出さず、ブリッジでも `once`・`deny` 以外の回答を受け付けない**（`always` はprofileの `command_allowlist` に書き込まれ、
  以後の確認が消える。#725）。`clarify`（選択肢つきの質問）は承認ではないので、ふつうの質問として出す

### 期限

| 対象 | 期限 | 過ぎたら |
|---|---|---|
| Morrowの提案（承認待ちの行） | **1時間** | 「期限切れ」と出し、押せなくする。同じことをするなら頼み直す（古い値で後から動かない） |
| Hermesの `approval` | `approvals.timeout`（300秒） | Hermes側で拒否として扱われる。接続が切れた場合もブリッジが中断し、拒否で終わる（#726） |

- 提案は、作ったときのターンが終わっても残る（承認は後からでよい）。ただし1時間を過ぎたものは実行しない
- 実行の直前に、提案の元になった前提（予定がまだあるか、など）を道具の側の検査に任せる（`aide_delete_event` の `title` 一致など）

## 二重実行の防止

- **Morrowが実行する提案**: 承認待ちの行の状態を `pending → executing` へ1回だけ進めた側だけが実行する（`updateMany` の件数で判定。
  MCPの認可のstate〔#469〕と同じ形）。ボタンの連打・2つの端末からの承認でも1回しか走らない
  - 道具の冪等キーは提案のIDから作る（`morrow-hermes-<提案ID>`）。`asset_manager_import_payment` は従来どおり `gmailMessageId`
  - 実行がタイムアウト・結果不明のときは、**同じキーで**再試行する（新しいキーで作り直さない。AIDEの道具の説明どおり）
- **Hermesが自動で行う書き込み**: Morrowからは冪等キーを強制できない。AIDEの道具が `idempotencyKey` を必須にしているもの（タスク・移動）は
  AIDE側で守られる。**予定の作成・更新（`aide_create_event`・`aide_update_event`）は冪等キーが無く**、Hermesがタイムアウトで呼び直すと
  重複しうる → AIDEへ冪等キーの追加を依頼した（guchi-apps/aide#823）。それまでは結果カードで重複に気付けるようにする
- **同じ指示の二重送信**: 1セッション1ターン（2本目は409。#726）。送れなかった指示は溜めずに入力欄へ戻す（#726）
- #689との関係: 許可リスト（`callWriteToolJson()`）・`idempotencyKey`・`gmailMessageId`・持ち主の照合の考え方はそのまま延長できる。
  違いは、提案の作り手がCodex（Morrow内）ではなくHermesで、元データがメール本文に限られないこと

## 実行の記録

Morrowに「誰が・いつ・何を」だけを残す（#683の `MailTriage` と同じく、本文はMorrowに残さない）。会話の本文・履歴の正はHermes側のセッション。

| 残す | 残さない |
|---|---|
| 利用者・Hermesのセッションid・道具名・区分（自動／提案）・状態（自動実行・承認待ち・実行済み・取り下げ・期限切れ・失敗）・時刻・冪等キー・結果の種類（`imported`・`duplicate` など）・対象のid（taskId・receiptIdなど） | 指示文・返答の本文、道具の引数・結果の本文（金額・相手先・予定の内容・メールの中身） |

- **提案の引数（値）は承認待ちの間だけ持ち、実行・取り下げ・期限切れで消す**（カードに出すために必要な間だけ）
- 自動の書き込みは、ストリームの `tool.start`／`tool.complete` から道具名と成否だけを記録する
- 保存期間は90日を目安にする（本文を持たない記録なので害は小さいが、集計に使わないので長く持たない）。消す処理は実装Issueで決める
- 使用量は別に `ApiUsage` へ1ターン1行（#725・#726）

## 後続

- **提案の受け口・承認待ちの行・確認カードの実行API**（Morrow）: #748。#737（ブリッジ）の `morrow_propose_action`・`once`/`deny` の絞り込みと、
  #728（画面）の確認カードはこの文書を前提に作る
- **AIDEの道具の注釈と冪等キー**（`guchi-apps/aide`）: `readOnlyHint` の宣言と、`aide_create_event`・`aide_update_event` への `idempotencyKey`。guchi-apps/aide#823
- **profileの設定**（人の作業）: 上の表の値を #738 の手順に足す
