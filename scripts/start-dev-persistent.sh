#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck source=/dev/null
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

mkdir -p data

is_listening() {
  ss -tlnp 2>/dev/null | grep -q ":$1 "
}

health_ok() {
  case "$1" in
    3000) curl -sf -m 3 http://localhost:3000/health >/dev/null 2>&1 ;;
    5173) curl -sf -m 3 -o /dev/null -w '' http://localhost:5173/ >/dev/null 2>&1 ;;
  esac
}

start_api() {
  if is_listening 3000 && health_ok 3000 && [ -f data/dev-api.pid ] && kill -0 "$(cat data/dev-api.pid)" 2>/dev/null; then
    echo "API already running (pid $(cat data/dev-api.pid))"
    return
  fi

  if is_listening 3000; then
    echo "Stopping existing process on port 3000..."
    fuser -k 3000/tcp 2>/dev/null || true
    sleep 1
  fi

  echo "Starting API (nohup)..."
  nohup npm run dev >>data/dev-api.log 2>&1 &
  echo $! >data/dev-api.pid
}

start_web() {
  if is_listening 5173 && health_ok 5173 && [ -f data/dev-web.pid ] && kill -0 "$(cat data/dev-web.pid)" 2>/dev/null; then
    echo "Web UI already running (pid $(cat data/dev-web.pid))"
    return
  fi

  if is_listening 5173; then
    echo "Stopping existing process on port 5173..."
    fuser -k 5173/tcp 2>/dev/null || true
    sleep 1
  fi

  echo "Starting Web UI (nohup)..."
  nohup npm run dev:web >>data/dev-web.log 2>&1 &
  echo $! >data/dev-web.pid
}

start_api
start_web

echo "Waiting for services..."
for i in $(seq 1 30); do
  api_ok=false
  web_ok=false
  health_ok 3000 && api_ok=true
  health_ok 5173 && web_ok=true
  if $api_ok && $web_ok; then
    break
  fi
  sleep 1
done

echo ""
echo "API  pid=$(cat data/dev-api.pid 2>/dev/null || echo '?')  log=data/dev-api.log  url=http://localhost:3000"
echo "Web pid=$(cat data/dev-web.pid 2>/dev/null || echo '?')  log=data/dev-web.log  url=http://localhost:5173"
curl -sf http://localhost:3000/health && echo ""
curl -sf -o /dev/null -w "Web HTTP %{http_code}\n" http://localhost:5173/
