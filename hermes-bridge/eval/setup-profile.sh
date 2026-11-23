#!/usr/bin/env bash
# 評価専用のHermes profile（既定 morrow-evalstub）を作る（#1152）。
#
# 本番のMorrow profile（morrow）を元に、AIDEの接続先だけをスタブ（hermes-bridge/eval/stub-aide.ts）へ向ける。
# 許可リスト（mcp_servers.aide.tools.include）・platform_toolsets・SOUL.md・提案MCPはmorrowの現在の値をそのまま写すので、
# SOUL・許可リストを直したあとにもう一度流せば、評価にも反映される。
#
#   hermes-bridge/eval/setup-profile.sh            # 作る・作り直す
#   STUB_PORT=19131 PROPOSE_PORT=19132 hermes-bridge/eval/setup-profile.sh
#
# **morrow profile には書き込まない**（読むだけ）。評価用profileのAIDEのOAuthトークン・セッション・記憶は空のまま。
set -euo pipefail

PROFILE="${HERMES_EVAL_PROFILE:-morrow-evalstub}"
SOURCE="${HERMES_EVAL_SOURCE_PROFILE:-morrow}"
STUB_PORT="${STUB_PORT:-19131}"
PROPOSE_PORT="${PROPOSE_PORT:-19132}"
HERMES_HOME_DIR="${HERMES_HOME_DIR:-$HOME/.hermes}"

if [ "$PROFILE" = "morrow" ] || [ "$PROFILE" = "default" ]; then
  echo "setup-profile: 評価用profileに $PROFILE は使えない" >&2
  exit 2
fi

SRC_DIR="$HERMES_HOME_DIR/profiles/$SOURCE"
DST_DIR="$HERMES_HOME_DIR/profiles/$PROFILE"
[ -f "$SRC_DIR/config.yaml" ] || { echo "setup-profile: $SRC_DIR/config.yaml が無い" >&2; exit 2; }

if [ ! -d "$DST_DIR" ]; then
  hermes profile create "$PROFILE" --clone-from "$SOURCE" --no-alias
fi

# 元profileの設定を写し、AIDEの接続先・提案MCPの接続先だけを差し替える（行ごとの置換。YAMLの他の部分は触らない）
python3 - "$SRC_DIR/config.yaml" "$DST_DIR/config.yaml" "$STUB_PORT" "$PROPOSE_PORT" <<'PY'
import re
import sys

src, dst, stub_port, propose_port = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
lines = open(src, encoding="utf-8").read().splitlines()
out = []
server = None  # いま見ている mcp_servers 直下のサーバー名
in_mcp = False
for line in lines:
    if re.match(r"^\S", line):
        in_mcp = line.startswith("mcp_servers:")
        server = None
    elif in_mcp:
        m = re.match(r"^  ([A-Za-z0-9_-]+):\s*$", line)
        if m:
            server = m.group(1)
    if in_mcp and server == "aide":
        if re.match(r"^    url:", line):
            line = f"    url: http://127.0.0.1:{stub_port}/mcp"
        elif re.match(r"^    auth:", line):
            continue  # スタブはOAuth不要
    if in_mcp and server == "morrow_propose" and re.match(r"^    url:", line):
        line = f"    url: http://127.0.0.1:{propose_port}/mcp"
    out.append(line)
open(dst, "w", encoding="utf-8").write("\n".join(out) + "\n")
PY
chmod 600 "$DST_DIR/config.yaml"

# SOUL.md は元の現在の内容に揃える（記憶・セッション・OAuthトークンは写さない）
if [ -f "$SRC_DIR/SOUL.md" ]; then cp "$SRC_DIR/SOUL.md" "$DST_DIR/SOUL.md"; fi
mkdir -p "$DST_DIR/memories"
: > "$DST_DIR/memories/MEMORY.md"
: > "$DST_DIR/memories/USER.md"
rm -rf "$DST_DIR/mcp-tokens"

echo "setup-profile: $PROFILE を用意した（aide→127.0.0.1:$STUB_PORT、morrow_propose→127.0.0.1:$PROPOSE_PORT）"
echo "次: pnpm hermes-eval --profile $PROFILE"
