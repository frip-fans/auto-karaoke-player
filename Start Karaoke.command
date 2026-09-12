#!/bin/bash
set -e
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
trap 'echo; echo "启动失败，请查看上面的错误。按回车关闭。"; read -r' ERR
command -v node >/dev/null || { echo '请先安装 Node.js 22.12+：brew install node'; exit 1; }
command -v ffmpeg >/dev/null || { echo '请先安装 FFmpeg：brew install ffmpeg'; exit 1; }
command -v ffprobe >/dev/null || { echo '请先安装 ffprobe（包含在 FFmpeg 中）'; exit 1; }
if [ ! -d node_modules ]; then npm ci; fi
if [ ! -f dist/server/cli.js ]; then npm run build; fi
exec node dist/server/cli.js --library "${1:-$PWD/songs}"
