#!/usr/bin/env bash
# チャットに添付された画像の掃除（#1157）。subpcで毎時などに流す（cron）。
#
# tui_gateway の image.attach_bytes は画像を <profile>/images/ へ置く。Hermesの毎時の掃除（24時間）は
# cache/images・image_cache を対象にしていて、ここは対象外（2026-11-24にコードで確認）。個人情報（レシート・住所の写り込み）が
# 残り続けないよう、古いものを消す。使い方: prune-images.sh [profileのHOME] [残す時間（既定24）]
set -euo pipefail
home="${1:-$HOME/.hermes/profiles/morrow}"
hours="${2:-24}"
dir="$home/images"
[ -d "$dir" ] || exit 0
find "$dir" -maxdepth 1 -type f \( -name 'upload_*' -o -name 'morrow-*' \) -mmin "+$((hours * 60))" -print -delete
