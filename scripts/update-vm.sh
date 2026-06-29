#!/usr/bin/env bash
# Pull latest RustTools on the VM and rebuild/restart Docker services.
# Usage (on VM): ./scripts/update-vm.sh
#
# Optional: OPS_DISCORD_WEBHOOK_URL in .env posts deploy success/failure to ops Discord.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

post_deploy_webhook() {
  local outcome="$1"
  local body="$2"
  local webhook="${OPS_DISCORD_WEBHOOK_URL:-}"
  [[ -z "$webhook" ]] && return 0
  if ! command -v jq >/dev/null 2>&1; then
    echo "OPS_DISCORD_WEBHOOK_URL set but jq missing — skipping deploy notification" >&2
    return 0
  fi
  local content="RustTools VM deploy: ${outcome}"
  content+=$'\n'"${body}"
  local payload
  payload="$(jq -n --arg content "$content" '{content: $content}')"
  curl -fsS -X POST "$webhook" \
    -H "Content-Type: application/json" \
    -d "$payload" >/dev/null 2>&1 || echo "Deploy webhook post failed" >&2
}

_deploy_failed() {
  local ec=$?
  post_deploy_webhook "FAILED (exit ${ec})" "Check logs on VM: cd ~/RustTools && docker compose logs api --tail 40"
  exit "$ec"
}
trap _deploy_failed ERR

if [[ ! -f docker-compose.yml ]]; then
  echo "Run this from the RustTools repo root (expected docker-compose.yml)." >&2
  exit 1
fi

echo "==> Fetching latest main..."
git fetch origin main
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse origin/main)"
PULLED=false

if [[ "$LOCAL" == "$REMOTE" ]]; then
  echo "Already up to date ($LOCAL)."
else
  echo "Updating $LOCAL -> $REMOTE"
  git pull --ff-only origin main
  PULLED=true
fi

echo "==> Rebuilding and restarting containers..."

chmod +x scripts/render-caddyfile.sh
./scripts/render-caddyfile.sh

if [[ -n "${WEB_DOMAIN:-}" ]]; then
  if [[ -z "${API_PUBLIC_URL:-}" ]]; then
    echo "WEB_DOMAIN is set but API_PUBLIC_URL is missing — needed to build the web UI." >&2
    exit 1
  fi
  echo "==> Building web UI (${WEB_DOMAIN} → API ${API_PUBLIC_URL})..."
  docker run --rm \
    -v "$ROOT:/app" -w /app \
    -e VITE_API_URL="$API_PUBLIC_URL" \
    -e VITE_BASE_PATH=/ \
    -e "VITE_LIVE_CAMERAS=${VITE_LIVE_CAMERAS:-}" \
    node:20-bookworm-slim \
    bash -c "npm ci && npm run build --workspace=@rusttools/shared && npm run build --workspace=@rusttools/web"
else
  echo "WEB_DOMAIN unset — skipping VM web build (API-only or use GitHub Pages for UI)."
  mkdir -p apps/web/dist
  if [[ ! -f apps/web/dist/index.html ]]; then
    echo '<!DOCTYPE html><html><body><p>Set WEB_DOMAIN in .env and re-run update-vm.sh to build the dashboard.</p></body></html>' > apps/web/dist/index.html
  fi
fi

docker compose up -d --build

echo ""
echo "==> Container status:"
docker compose ps

HEALTH_SNIPPET="Health: (DOMAIN not set)"
DOMAIN="${DOMAIN:-}"
if [[ -z "$DOMAIN" && -f .env ]]; then
  DOMAIN="$(grep -E '^DOMAIN=' .env 2>/dev/null | head -1 | cut -d= -f2- || true)"
fi
if [[ -n "$DOMAIN" ]]; then
  echo ""
  echo "Health check:"
  if HEALTH_JSON="$(curl -fsS --max-time 30 "https://${DOMAIN}/health" 2>&1)"; then
    echo "$HEALTH_JSON" | head -c 200
    echo ""
    HEALTH_SNIPPET="Health: $(echo "$HEALTH_JSON" | head -c 120)"
  else
    echo "(curl failed — check logs)"
    HEALTH_SNIPPET="Health: curl failed"
  fi
fi

COMMIT="$(git rev-parse --short HEAD)"
MSG="Commit: ${COMMIT}"
if [[ "$PULLED" == "true" ]]; then
  MSG+=$'\n'"Updated ${LOCAL:0:7} → ${REMOTE:0:7}"
else
  MSG+=$'\n'"No git changes; rebuilt containers"
fi
MSG+=$'\n'"${HEALTH_SNIPPET}"

trap - ERR
post_deploy_webhook "OK" "$MSG"

echo "Done. If slash commands changed, re-run Phase I from your laptop."
