#!/usr/bin/env bash
# subpc の作業ツリーの ios/ を Tailscale 越しに Mac へ送り、署名なしでビルドできるか確かめる（#3846）。
# subpc に Xcode が無いため、Swift の変更をコミットする前に「コンパイルが通るか」を見る用途。
# 署名・アーカイブ・TestFlightへのアップロードはしない（それは remote-upload-testflight.sh / CI）。
#
#   ios/scripts/remote-build-check.sh
#
# 環境変数（すべて任意）:
#   MAC_HOST      SSH先（既定 guchimac-mini）。`local` を指定すると SSH せずこの機でビルドする
#   MAC_WORK_DIR  Mac 上の作業ディレクトリ（既定 /tmp/morrow-ios-build-check）。毎回この中身を置き換える
#
# Mac 自身（uname -s が Darwin）で実行したときは、MAC_HOST が未指定なら SSH せずにその場でビルドする（#1114）。
# Mac から別の Mac へ送りたいときだけ MAC_HOST を明示する。
#
# 実機での動作（日本語入力・キーボード・TestFlightからの起動）はここでは確かめられない。
set -euo pipefail

WORK_DIR="${MAC_WORK_DIR:-/tmp/morrow-ios-build-check}"
IOS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "${MAC_HOST:-}" = "local" ] || { [ -z "${MAC_HOST:-}" ] && [ "$(uname -s)" = "Darwin" ]; }; then
  LOCAL=1
else
  LOCAL=0
  HOST="${MAC_HOST:-guchimac-mini}"
fi

# 終了コードをパイプで隠さない。生成物は作業ディレクトリ内の DerivedData に閉じる。
# SSH 先の実行シェルは Mac の既定ログインシェル（zsh）なので、bash 専用の PIPESTATUS は使わない。
# パイプを使わず、ログをファイルへ出して xcodebuild の終了コードを変数に取る（zsh・bash どちらでも動く）。
BUILD_CMD="cd '$WORK_DIR/ios' && { xcodebuild \
  -project Morrow.xcodeproj -scheme Morrow -configuration Debug \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath '$WORK_DIR/DerivedData' \
  CODE_SIGNING_ALLOWED=NO build > '$WORK_DIR/build.log' 2>&1; rc=\$?; tail -n 8 '$WORK_DIR/build.log'; exit \$rc; }"

if [ "$LOCAL" = 1 ]; then
  mkdir -p "$WORK_DIR/ios"
  rsync -a --delete --exclude build --exclude DerivedData "$IOS_DIR/" "$WORK_DIR/ios/"
  # set -e のもとでも、失敗の終了コードがそのままこのスクリプトの終了コードになる。
  bash -c "$BUILD_CMD"
else
  ssh "$HOST" "mkdir -p '$WORK_DIR'"
  rsync -az --delete --exclude build --exclude DerivedData "$IOS_DIR/" "$HOST:$WORK_DIR/ios/"
  ssh "$HOST" "$BUILD_CMD"
fi
