# Hermesのスキル・記憶の書き込み承認の実測（#1153）

後続の「スキルの承認フロー」「記憶の承認制」を設計する前提として、Hermes標準の書き込み承認（`write_approval`）を実測した結果。
実測日: 2026-11-24。環境: subpc・Hermes v0.22.5（`bf0203a794`）・モデル `gpt-6-sol`。

**検証は本番の `morrow` profile に触れず、検証用の `morrow-eval`（`hermes profile create morrow-eval --clone-from morrow --no-alias`）で行った。**
`morrow` の `config.yaml`・`memories/`・`skills/` は変更されていない（更新時刻が実測前のまま）。

> **#1154で、この実測の結果を使った承認フローを実装した**（`docs/hermes-route.md`「スキルの確認・承認」）。

## 結論

- **Morrowの画面で承認する形は組める。** 書き込みは `<HERMES_HOME>/pending/{skills,memory}/<id>.json` に保留され、
  承認の適用・却下・差分表示は、ブリッジが張っているのと同じWebSocketの `command.dispatch` で呼べる（下の2）。**新しい経路は要らない**
- **`skill_manage` だけを止める設定は無い**（5）。止める手段は「保留へ回す（`write_approval`）」か「`skills` ツールセットごと外す」
- 自動作成（ナッジ）は動き、**承認ONなら保留に入る**（3）。ただし**同梱スキルへの patch も提案される**ので、承認画面は差分を必ず見せる前提にする
- 入力トークンは**スキルの一覧だけで約7,700増える**（1）。常時有効にするかは費用と相談

## 1. `skills` ツールセットを有効にしたとき

- 有効化: `hermes -p morrow-eval tools enable skills memory --platform cli`。モデルに見える道具は `skills_list`・`skill_view`・`skill_manage`（`memory` も）
- **スキルの一覧はシステムプロンプトへ入る**。1回の呼び出しの入力トークン（挨拶1行・ツールなし。`message.complete` の `usage.prompt`）:

  | 構成 | 入力トークン |
  |---|---|
  | web のみ（いまの morrow） | 2,687 |
  | + skills | 約10,400 |
  | + skills + memory | 約12,060 |

  同梱スキルが61個（morrow profile）。**キャッシュが効けば（cache_hit 95%前後）実費は小さいが、枠は消費する**。
  なお最初の1回だけ5,859という値も出た（キャッシュ・一覧の組み立ての違いと思われる。原因は未確認）
- **スキルは実際に使う**: `eval-hello` を承認後に「あれば読んで従って」と頼むと `skill_view` を呼び、その指示どおり答えた
- 注意: **`hermes chat -q`（ワンショット）は「スキルを作るな」という指示が付く**ため検証に使えない（モデルが作成を断った）。
  実測はブリッジと同じ `serve --isolated` のWebSocket経由（`session.create` → `prompt.submit`）で行った

## 2. 書き込み承認（`skills.write_approval` / `memory.write_approval`）

`hermes -p morrow-eval config set skills.write_approval true`（`memory.` も同じ）。

- **保留される**: `skill_manage`・`memory` の結果が `{"success":true,"staged":true,"pending_id":"…"}` になり、実体は書かれない。
  保留は `pending/skills/<id>.json`・`pending/memory/<id>.json`（`summary`・`origin`・`payload`）
- **記憶は、ブリッジ経由（承認の窓口が無い）では即保留**。CLIでは記憶だけ「その場の承認」を聞くが、WebSocketにはその口が無く保留に落ちた。
  スキルは起源によらず常に保留
- **承認の適用はブリッジから呼べる**。`command.dispatch`（`name`・`arg`・`session_id`）で、`arg` に半角スペース区切りの全体を渡す
  （`name` が `skills`／`memory`、`arg` が `pending`・`diff <id>`・`approve <id>`・`reject <id>`）。実測結果:

  | 呼び出し | 結果 |
  |---|---|
  | `skills` / `pending` | `Pending skills writes (1):  410efc5d  batch(1 ops: create) on eval-hello …` |
  | `skills` / `diff 410efc5d` | `## op 1/1: create 'eval-hello' …` に続けてSKILL.mdの全文 |
  | `skills` / `approve 410efc5d` | `Approved 1 skills write(s).` → `skills/eval-hello/SKILL.md` ができた |
  | `memory` / `approve 8932a6ca` | `Approved 1 memory write(s).` → `memories/USER.md` に追記された |
  | `memory` / `reject 5c0d1cdb` | `Rejected pending memory write '5c0d1cdb'.`（保留ファイルが消えた） |

  **注意**: `arg` を `["skills","approve","<id>"]` のように分けて `name` だけ渡し `arg` に最初の語だけ入れると `Usage: …` が返る。
  `slash.exec`（`/skills pending`）も使えるが、承認系は `command.dispatch` を使う（`slash.exec` は内部で `command.dispatch` へ回る）
- **差分は文字列で返る**（`skill_pending_diff`。作成は全文、編集・patchはunified diff）。画面に出せる。
  応答は `{"type":"exec","output":"…"}` のテキストのみで、構造化されていない（id・要約は `pending` の出力を読むか、
  `pending/*.json` を直接読む必要がある。**ブリッジにJSONで返す口を足すなら `pending/` を読むのが確実**）
- 出力の `[auto]` は自動作成（`origin: background_review`）の印
- 承認する主体はMorrowのサーバー（ブリッジ）。**`hermes -p morrow serve` のトークンは管理者権限**なので、
  `command.dispatch` の `arg` は `pending`・`diff`・`approve`・`reject` だけに絞って中継する（`approval`・`mode` は通さない。ゲート自体を切れてしまう）

## 3. 自動作成（`skills.creation_nudge_interval`）

- ツール呼び出しの回数（`skill_manage` を呼ばずに回した往復）が間隔に達したターンの終わりに、**バックグラウンドで見直し用のエージェントが走る**
  （ログ: `Background review complete: … thread=bg-review`）。実測は間隔2（morrow profile は15）
- **書き込み承認ONなら、見直しの書き込みも保留に入る**（`origin: background_review`・`pending/skills/8068d433.json`）。
  Web検索3回のやり取りのあと、**同梱スキル `grounded-citations` への patch** が提案された
- 見直しはセッションを閉じても少し続く（ログでは `interrupt_abort` で打ち切られた回もあった）。**いつ保留が現れるかは分からない**ので、
  画面は保留の件数を取り直す導線（バッジ・更新）を持つ必要がある
- 見直しはモデルを追加で呼ぶ（上のログで入力約2万・出力約400）。ナッジを下げるほど消費が増える

## 4. `/learn`

- `command.dispatch` の `name: "learn"` は**実行せずに**`{"type":"send","message":"[/learn] The user wants you to learn …"}` を返す。
  クライアントがその `message` を `prompt.submit` で送り直す仕組み。**ブリッジはいまこの `send` を処理しない**ので、
  `/learn` を使うならブリッジ（またはMorrow）が `command.dispatch` → `send` の本文を `prompt.submit` する処理を足す
- `prompt.submit` に `/learn …` の文字列をそのまま送っても展開されないが、モデルは依頼として解釈して `skill_manage` を呼び、
  作成は承認ONなので保留に入った（動くが、決まった `/learn` の指示文は付かない）
- 「直前までのやり取り」はモデルから見えず、一般的な内容で作られた（展開しないと元の文脈を参照できない）

## 5. `skill_manage` だけを止める

- **`hermes tools disable skills:skill_manage` は効かない**（`MCP server 'skills' not found in config`）。個別の道具の無効化は `server:tool` 形式のMCPだけで、
  組み込みの `skills` ツールセット（`skills_list`・`skill_view`・`skill_manage`）は分けられない
- 代替案（強い順）:
  1. **`skills.write_approval: true`＋Morrowが `reject` だけ／承認画面を通す**（本文書の形）。書き込みは常に保留で、承認しなければ何も変わらない
  2. 「読むだけ」にしたいなら、スキルは人がファイルとして置き、**`skills` ツールセットを有効にしたまま `write_approval` を ON のまま、承認を一切出さない**（保留は溜まるので `reject all` を定期実行）
  3. スキル不要なら `skills` ツールセットを外す（いまの状態。入力トークンも増えない）
  - **指示文（SOUL.md）での禁止は保証にならない**（#725と同じ）

## 6. 保存先と他profileへの波及

- 承認後のスキル: `~/.hermes/profiles/morrow-eval/skills/eval-hello/SKILL.md`。記憶: `~/.hermes/profiles/morrow-eval/memories/USER.md`
- **`morrow` profile・default profile（`~/.hermes/skills`・`~/.hermes/memories`）への波及は無い**（`eval-hello` は0件、`猫` を含む記憶も0件。
  `morrow` の `config.yaml`・`memories/` の更新時刻も変わらず）。保留もprofile単位（`<profile>/pending/`）
- `--clone-from morrow` は**同梱スキルも写す**（61→62個）。つまり本番の morrow にスキルを有効化すると、同梱スキルの patch も承認の対象になる

## 後続の設計への示唆

- 承認フローは `pending/*.json`（またはブリッジの中継）→ Morrowの確認カード（差分つき）→ `approve`／`reject` の中継、で組める。
  **Hermesのチャット上の承認（`approval.respond`。`once`・`deny`）とは別物**で、`#727` の `morrow_propose_action` とも独立
- 記憶・スキルとも**承認を忘れた保留が溜まる**ので、件数バッジ（`pending_count`）と、古い保留の整理を決めておく
- 通知（`hermes-approval`）に載せるなら、保留はターンの終わりだけでなくナッジの見直し完了後にも増える点を考慮する

## 再現手順

```bash
# subpc（人の作業。~/.hermes を触る）
hermes profile create morrow-eval --clone-from morrow --no-alias
hermes -p morrow-eval tools enable skills memory --platform cli
hermes -p morrow-eval config set skills.write_approval true
hermes -p morrow-eval config set memory.write_approval true
HERMES_DASHBOARD_SESSION_TOKEN=<任意> hermes -p morrow-eval serve --isolated --host 127.0.0.1 --port 19199
# WebSocket: client.capabilities {server_requests:true} → session.create {source:"morrow"} → prompt.submit
#            → command.dispatch {name:"skills", arg:"pending"|"diff <id>"|"approve <id>"|"reject <id>", session_id}
# 後始末（serve を止める）
hermes profile delete morrow-eval
```

## 追記（#1155）記憶ファイルの書式と反映のタイミング（2026-11-24）

一時ディレクトリを `HERMES_HOME` にして、Hermesの `MemoryStore`（`tools/memory_tool_store.py`）で `add` を実走して確かめた（本番profileには触れていない）。

- **項目は `\n§\n` で区切る。末尾の改行は無い**。`add("user", "呼び名はかずさん")`→`add("user", "自宅の最寄りは草津駅")` の後の `USER.md` は `呼び名はかずさん\n§\n自宅の最寄りは草津駅`（バイト列で確認）。`MEMORY.md` は `target: memory`、`USER.md` は `target: user`
- 隣に `<file>.lock`（0600・空）ができる。Hermesの書き込みはこのファイルのflockで直列化され、本体は一時ファイル＋renameで置き換わる
- **記憶は会話（セッション）の開始時に読み込んで固定する**（`_system_prompt_snapshot` は「frozen at load time」。会話の途中の書き込みは反映されない）。承認・削除とも、効くのは新しい会話から
- 保留の `payload` は `memory` 道具の呼び出しそのもの（`{action, target, content, old_text, matched_entry}` または `{action: "batch", target, operations[]}`）。`replace`/`remove`/`patch` は保留に入る時点で対象の項目の全文が `matched_entry` に固定される（承認時に別の項目へ当たらない）。**`memory` の `command.dispatch` に `diff` は無い**（スキルだけ）
- **未実測（実機で確かめる）**: ブリッジ経由の `tool.complete` の `name` が `memory` で、`result` に `"staged":true` が入ること（`turns/route.ts` はこれで通知する。違えば通知が出ないだけで、`/memory` の件数バッジで気付ける）
