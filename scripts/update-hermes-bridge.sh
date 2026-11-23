#!/usr/bin/env bash
#
# subpcのHermesブリッジ（morrow-hermes-bridge）を origin/main の版へ更新して再起動する（#1145）。
#
# **ブリッジはMorrowのデプロイ（deploy.yml）では配られない。** subpcの専用チェックアウト
# （既定 ~/apps/morrow-hermes-bridge。systemdのユーザーunitの WorkingDirectory）を手で進める必要があり、
# 忘れるとMorrowだけが新しいAPIを呼んで、古いブリッジが404 `not_found` を返す
# （#1145。11/8の版のまま止まっていて、履歴API〔#752〕が無く「前回の会話を読み込めませんでした」になっていた）。
# `hermes-bridge/` を変えたPRがmainへ入ったら、subpcでこれを流す。
#
# 使い方（subpcで）:
#
#   scripts/update-hermes-bridge.sh            # origin/main へ
#   scripts/update-hermes-bridge.sh <コミット>  # 版を指定（戻すとき）
#
# 再起動の数秒の間、進行中のターンは切れる（ブリッジは切断で中断する）。チャットを使っていないときに流す。
set -euo pipefail

BRIDGE_DIR="${MORROW_HERMES_BRIDGE_DIR:-$HOME/apps/morrow-hermes-bridge}"
ENV_FILE="${MORROW_HERMES_BRIDGE_ENV:-$HOME/.config/morrow-hermes/bridge.env}"
UNIT="morrow-hermes-bridge"
TARGET="${1:-origin/main}"

cd "$BRIDGE_DIR"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "エラー: $BRIDGE_DIR に未コミットの変更があります。片付けてから流してください。" >&2
  exit 1
fi

before=$(git rev-parse --short HEAD)
git fetch --quiet origin main
target_sha=$(git rev-parse --verify --quiet "${TARGET}^{commit}") || {
  echo "エラー: $TARGET が見つかりません。" >&2
  exit 1
}
git checkout --quiet --detach "$target_sha"
after=$(git rev-parse --short HEAD)
echo "ブリッジ: $before -> $after"
git log --oneline "$before..$after" -- hermes-bridge src/lib/hermes/contract.ts || true

systemctl --user restart "$UNIT"

# /health は認証の内側。トークンと許可済みの送信元（tailscale serveが付ける X-Forwarded-For）を真似て叩く
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
client_ip="${MORROW_HERMES_BRIDGE_ALLOWED_IPS%%,*}"
for _ in $(seq 1 15); do
  if body=$(curl -fsS --max-time 10 \
    -H "Authorization: Bearer ${MORROW_HERMES_BRIDGE_TOKEN}" \
    -H "X-Forwarded-For: ${client_ip}" \
    "http://127.0.0.1:${MORROW_HERMES_BRIDGE_PORT}/health" 2>/dev/null); then
    echo "health: $body"
    exit 0
  fi
  sleep 1
done
echo "エラー: 再起動後に /health が応答しません（journalctl --user -u $UNIT を見てください）。" >&2
exit 1
