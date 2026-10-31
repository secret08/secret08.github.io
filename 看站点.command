#!/bin/bash
# 双击这个文件 → 自动起一个本地小服务并打开浏览器
# 看完了把这个黑色终端窗口关掉就行
cd "$(dirname "$0")" || exit 1

# Astro 7 要求 Node >= 22.23.4，优先用 homebrew 装的版本
export PATH="/opt/homebrew/bin:$PATH"
PORT=8899

if [ ! -f dist/index.html ] || [ "$1" = "build" ]; then
  echo "正在用 Node $(node -v) 构建..."
  if npm run build > /tmp/site-build.log 2>&1; then
    echo "构建完成。"
  else
    echo "构建失败，最后几行如下，需要我看就截图给我："
    tail -20 /tmp/site-build.log
    read -n 1 -s -r -p "按任意键关闭窗口..."
    exit 1
  fi
fi

if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "服务已经在跑，直接打开浏览器。"
  open "http://127.0.0.1:$PORT/"
  exit 0
fi

echo "────────────────────────────────────"
echo "  站点地址：http://127.0.0.1:$PORT/"
echo "  这个窗口别关，关掉站点就停了。"
echo "────────────────────────────────────"

( sleep 1 && open "http://127.0.0.1:$PORT/" ) &
cd dist && exec python3 -m http.server $PORT --bind 127.0.0.1
