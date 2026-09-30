#!/usr/bin/env bash
# dev.sh — 「单词星球」本地开发脚本：一条命令起静态服务 + headless Chrome + 跑端到端测试
#
# 用法：
#   ./scripts/dev.sh           起服务 + 起 Chrome + 跑端到端测试
#   ./scripts/dev.sh start     只起服务与 Chrome
#   ./scripts/dev.sh test      只跑端到端测试（服务没起会自动先起）
#   ./scripts/dev.sh check     检查词库例句数据（scripts/check_sentences.py）
#   ./scripts/dev.sh open      用默认浏览器打开应用
#   ./scripts/dev.sh lan       打印局域网访问地址（手机 / 平板测试）
#   ./scripts/dev.sh status    查看服务与端口状态
#   ./scripts/dev.sh stop      停掉服务与 headless Chrome
#
# 可覆盖的环境变量：
#   PORT=8765  CDP_PORT=9333  CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
#
# 说明：静态服务绑定 0.0.0.0（IPv4 通配），本机用 http://127.0.0.1:PORT 访问、
#       同一 WiFi 下的手机用 lan 命令给出的 http://<本机IP>:PORT 访问。
set -uo pipefail

PORT="${PORT:-8765}"
CDP_PORT="${CDP_PORT:-9333}"
CHROME_BIN="${CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="${RUN_DIR:-/tmp/ket-dev}"

HTTP_LOG="$RUN_DIR/http.log"
CHROME_LOG="$RUN_DIR/chrome.log"
HTTP_PID_FILE="$RUN_DIR/http.pid"
CHROME_PID_FILE="$RUN_DIR/chrome.pid"
PROFILE_DIR="$RUN_DIR/chrome-profile"
LOCAL_URL="http://127.0.0.1:${PORT}/index.html"

mkdir -p "$RUN_DIR"

log()  { printf '%s\n' "$*"; }
ok()   { printf '  ✅ %s\n' "$*"; }
warn() { printf '  ⚠️  %s\n' "$*"; }

http_up()   { curl -s -o /dev/null -m 1 "$LOCAL_URL"; }
chrome_up() { curl -s -o /dev/null -m 1 "http://127.0.0.1:${CDP_PORT}/json/version"; }
http_pid()  { [ -f "$HTTP_PID_FILE" ] && cat "$HTTP_PID_FILE" || true; }
chrome_pid(){ [ -f "$CHROME_PID_FILE" ] && cat "$CHROME_PID_FILE" || true; }

# 找本机局域网 IPv4：优先走默认路由的网卡，跳过 VPN / 点对点 / 回环
lan_ip() {
  local iface ip def
  def="$(route -n get default 2>/dev/null | awk '/interface:/ {print $2}')"
  for iface in ${def:-} en0 en1 en2 en3; do
    [ -n "${iface:-}" ] || continue
    ip="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
    if [ -n "${ip:-}" ]; then printf '%s' "$ip"; return 0; fi
  done
  ifconfig 2>/dev/null | awk '
    /^[a-z0-9]+:/ { iface = $1 }
    /inet / && $2 !~ /^127\./ && iface !~ /^(utun|awdl|llw|bridge|gif|stf|anpi|ap|lo)/ { print $2; exit }'
}

start_http() {
  if http_up; then
    if [ -n "$(http_pid)" ]; then
      ok "静态服务器已在运行：${LOCAL_URL}（pid $(http_pid)）"
    else
      ok "静态服务器已在运行：${LOCAL_URL}（非本脚本启动，端口 ${PORT} 已被占用）"
      warn "若要按 0.0.0.0 重新绑定以支持局域网访问，先执行：./scripts/dev.sh stop"
    fi
    return 0
  fi
  log "▶ 启动静态服务器（端口 ${PORT}，绑定 0.0.0.0）…"
  # 注意：这里必须用「单条命令 + 后台」的写法。若写成 ( cd ... && nohup ... & )，
  # 由于 & 作用于整个 && 列表，会多出一个常驻子 shell 持有父进程 stdout，
  # 导致调用方（如 ./scripts/dev.sh | tail）永远等不到 EOF，且记录到错误的 PID。
  nohup python3 -m http.server "$PORT" --bind 0.0.0.0 --directory "$ROOT" \
    < /dev/null > "$HTTP_LOG" 2>&1 &
  echo $! > "$HTTP_PID_FILE"
  disown 2>/dev/null || true
  local i
  for i in $(seq 1 24); do
    if http_up; then
      ok "静态服务器就绪：${LOCAL_URL}（pid $(http_pid)，日志 ${HTTP_LOG}）"
      return 0
    fi
    sleep 0.25
  done
  warn "静态服务器没能就绪，看看日志：tail -20 ${HTTP_LOG}"
  return 1
}

start_chrome() {
  if chrome_up; then
    ok "headless Chrome 已在运行（CDP 端口 ${CDP_PORT}，pid $(chrome_pid)）"
    return 0
  fi
  if [ ! -x "$CHROME_BIN" ]; then
    warn "找不到 Chrome：${CHROME_BIN}（可用 CHROME_BIN=… 指定）"
    return 1
  fi
  log "▶ 启动 headless Chrome（CDP 端口 ${CDP_PORT}）…"
  rm -rf "$PROFILE_DIR"
  nohup "$CHROME_BIN" \
    --headless=new --disable-gpu --mute-audio \
    --autoplay-policy=no-user-gesture-required \
    --remote-debugging-port="$CDP_PORT" \
    --user-data-dir="$PROFILE_DIR" \
    --no-first-run --no-default-browser-check \
    about:blank < /dev/null > "$CHROME_LOG" 2>&1 &
  echo $! > "$CHROME_PID_FILE"
  disown 2>/dev/null || true
  local i
  for i in $(seq 1 32); do
    if chrome_up; then
      ok "headless Chrome 就绪（pid $(chrome_pid)，日志 ${CHROME_LOG}）"
      return 0
    fi
    sleep 0.25
  done
  warn "headless Chrome 没能就绪，看看日志：tail -20 ${CHROME_LOG}"
  return 1
}

stop_all() {
  local pid
  pid="$(chrome_pid)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null && ok "已停止 headless Chrome（pid ${pid}）"
  else
    pkill -f "remote-debugging-port=${CDP_PORT}" 2>/dev/null && ok "已停止 headless Chrome（CDP ${CDP_PORT}）"
  fi
  pid="$(http_pid)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null && ok "已停止静态服务器（pid ${pid}）"
  else
    pid="$(lsof -t -nP -iTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null | head -1)"
    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null && ok "已停止占用端口 ${PORT} 的进程（pid ${pid}）"
    else
      warn "静态服务器进程已不在（端口 ${PORT}）"
    fi
  fi
  rm -f "$HTTP_PID_FILE" "$CHROME_PID_FILE"
  rm -rf "$PROFILE_DIR"
}

status() {
  if http_up; then ok "静态服务器运行中：${LOCAL_URL}（pid $(http_pid)）"; else warn "静态服务器未运行（端口 ${PORT}）"; fi
  if chrome_up; then ok "headless Chrome 运行中：127.0.0.1:${CDP_PORT}（pid $(chrome_pid)）"; else warn "headless Chrome 未运行（CDP ${CDP_PORT}）"; fi
}

show_lan() {
  local ip; ip="$(lan_ip)"
  log "本机访问：${LOCAL_URL}"
  if [ -n "${ip:-}" ]; then
    log "局域网访问（同一 WiFi 的手机 / 平板）：http://${ip}:${PORT}/index.html"
  else
    warn "没找到局域网 IPv4 地址（可能没连 WiFi）"
  fi
}

run_test() {
  log "▶ 运行端到端测试（node scripts/e2e_wordbook.mjs）…"
  ( cd "$ROOT" && APP_URL="$LOCAL_URL" CDP_PORT="$CDP_PORT" node scripts/e2e_wordbook.mjs )
  local code=$?
  if [ $code -eq 0 ]; then ok "端到端测试全部通过"; else warn "端到端测试存在失败项（退出码 ${code}）"; fi
  return $code
}

case "${1:-all}" in
  start)  start_http && start_chrome ;;
  test)   start_http && start_chrome && run_test ;;
  check)  ( cd "$ROOT" && python3 scripts/check_sentences.py ) ;;
  open)   start_http && open "$LOCAL_URL" && ok "已在默认浏览器打开 ${LOCAL_URL}" ;;
  lan)    start_http && show_lan ;;
  status) status; show_lan ;;
  stop)   stop_all ;;
  all)
    if ! start_http || ! start_chrome; then exit 1; fi
    run_test
    code=$?
    show_lan
    exit "$code"
    ;;
  *)      log "未知命令：$1"; log "可用命令：start | test | check | open | lan | status | stop（默认 all）"; exit 2 ;;
esac
