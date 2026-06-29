#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=".env"
REMINDERS_FILE="data/DEPLOY-REMINDERS.txt"

if [[ ! -f "$ENV_FILE" ]]; then
  cp .env.example "$ENV_FILE"
  echo "Created $ENV_FILE from .env.example"
fi

gen_secret() {
  openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64
}

gen_hex_secret() {
  openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p -c 64
}

env_value() {
  local key="$1"
  grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true
}

is_blank() {
  [[ -z "$(echo "${1:-}" | tr -d '[:space:]')" ]]
}

if grep -q "change-me-to-a-long-random-string" "$ENV_FILE"; then
  SECRET=$(gen_secret)
  sed -i "s|SESSION_SECRET=change-me-to-a-long-random-string|SESSION_SECRET=$SECRET|" "$ENV_FILE"
  echo "Generated SESSION_SECRET"
fi

if grep -q "change-me-32-byte-hex-or-base64-key-for-tokens" "$ENV_FILE"; then
  KEY=$(gen_secret)
  sed -i "s|ENCRYPTION_KEY=change-me-32-byte-hex-or-base64-key-for-tokens|ENCRYPTION_KEY=$KEY|" "$ENV_FILE"
  echo "Generated ENCRYPTION_KEY"
fi

if grep -q "change-me-to-a-32-plus-character-random-internal-api-key" "$ENV_FILE"; then
  KEY=$(gen_hex_secret)
  sed -i "s|INTERNAL_API_KEY=change-me-to-a-32-plus-character-random-internal-api-key|INTERNAL_API_KEY=$KEY|" "$ENV_FILE"
  echo "Generated INTERNAL_API_KEY (64-char hex)"
fi

mkdir -p data

# --- Checklist: .env values still required ---------------------------------

MISSING=()

check_env() {
  local key="$1"
  local label="$2"
  if is_blank "$(env_value "$key")"; then
    MISSING+=("$label ($key)")
  fi
}

check_env "DISCORD_CLIENT_ID" "Discord application client ID"
check_env "DISCORD_CLIENT_SECRET" "Discord OAuth client secret"
check_env "DISCORD_BOT_TOKEN" "Discord bot token"
check_env "DISCORD_GUILD_ID" "Discord server/guild ID"
check_env "DOMAIN" "Public domain for Caddy HTTPS"
check_env "ACME_EMAIL" "Let's Encrypt contact email"
check_env "API_PUBLIC_URL" "Public API URL (https://your-domain)"
check_env "DISCORD_REDIRECT_URI" "Discord OAuth redirect (https://your-domain/auth/discord/callback)"
check_env "CORS_ORIGINS" "GitHub Pages origin for CORS (https://user.github.io)"
check_env "FRONTEND_URL" "GitHub Pages app URL with repo path"

ROLE_ADMIN="$(env_value DISCORD_ROLE_ADMIN)"
ROLE_SWITCH="$(env_value DISCORD_ROLE_SWITCH)"
ROLE_VIEW="$(env_value DISCORD_ROLE_VIEW)"
if is_blank "$ROLE_ADMIN" && is_blank "$ROLE_SWITCH" && is_blank "$ROLE_VIEW"; then
  MISSING+=("At least one Discord role ID (DISCORD_ROLE_ADMIN, DISCORD_ROLE_SWITCH, or DISCORD_ROLE_VIEW)")
fi

NODE_ENV="$(env_value NODE_ENV)"
UNPROMPTED="$(env_value RUSTPLUS_ALLOW_UNPROMPTED_PAIR)"
WARNINGS=()
if [[ "$NODE_ENV" == "production" && "$UNPROMPTED" == "true" ]]; then
  WARNINGS+=("RUSTPLUS_ALLOW_UNPROMPTED_PAIR=true is not allowed in production — remove or set to false")
fi

API_URL="$(env_value API_PUBLIC_URL)"
DOMAIN_VAL="$(env_value DOMAIN)"
if ! is_blank "$API_URL" && ! is_blank "$DOMAIN_VAL"; then
  if [[ "$API_URL" != *"$DOMAIN_VAL"* ]]; then
    WARNINGS+=("API_PUBLIC_URL should use DOMAIN ($DOMAIN_VAL)")
  fi
fi

REDIRECT="$(env_value DISCORD_REDIRECT_URI)"
if ! is_blank "$REDIRECT" && ! is_blank "$DOMAIN_VAL"; then
  if [[ "$REDIRECT" != *"$DOMAIN_VAL"* ]]; then
    WARNINGS+=("DISCORD_REDIRECT_URI should use DOMAIN ($DOMAIN_VAL)")
  fi
fi

# --- GitHub Actions reminder (not stored in .env) ----------------------------

GITHUB_REPO="${GITHUB_REPOSITORY:-SypherXN/RustTools}"
PAGES_URL="$(env_value FRONTEND_URL)"
SUGGESTED_VITE_API_URL="${API_URL:-https://rusttools.yourdomain.com}"

cat > "$REMINDERS_FILE" <<EOF
RustTools deploy reminders
Generated: $(date -u +"%Y-%m-%d %H:%M UTC")

== GitHub Actions (repository variables) ==
Repo: https://github.com/${GITHUB_REPO}/settings/variables/actions

Required:
  VITE_API_URL = ${SUGGESTED_VITE_API_URL}
    (API origin only — no trailing slash. Must match your live Caddy/API domain.)

Optional:
  VITE_LIVE_CAMERAS = false   (hide Cameras page in the Pages build)

Optional VM auto-deploy (GitHub Actions):
  VM_DEPLOY_ENABLED = true
  Secrets: VM_HOST, VM_USER, VM_SSH_KEY, VM_REPO_PATH
  See docs/SETUP.md section 16 and docs/OPS-AUTOMATION.md

Optional scheduled smoke (GitHub Actions):
  SMOKE_SCHEDULED_ENABLED = true
  Secrets: SMOKE_API_URL, SMOKE_INTERNAL_API_KEY

After setting VITE_API_URL, push to main or re-run "Deploy GitHub Pages" workflow.
Pages UI URL (from FRONTEND_URL): ${PAGES_URL:-<set FRONTEND_URL in .env>}

== Discord Developer Portal ==
OAuth redirect (production): ${REDIRECT:-https://YOUR_DOMAIN/auth/discord/callback}
Must match DISCORD_REDIRECT_URI in .env exactly.

Bot branding (optional but recommended):
  Icon: apps/discord-bot/assets/icon-512.png
  Banner: apps/discord-bot/assets/discord-banner.png (680x240, 17:6)
  See apps/discord-bot/assets/README.md

== After VM deploy ==
1. docker compose up -d --build
2. curl https://YOUR_DOMAIN/health
3. Register FCM: npx @liamcottle/rustplus.js fcm-register --config-file=./data/fcm-config.json
   (or upload via Settings → Admin)
4. npm run register-commands --workspace=@rusttools/discord-bot
5. npm run test:smoke   (optional; set SMOKE_API_URL=https://YOUR_DOMAIN)

== Optional hands-off ops (see docs/SETUP.md section 16) ==
- OPS_DISCORD_WEBHOOK_URL in .env (ops channel webhook)
- Cron: scripts/health-watch.sh --quiet, scripts/backup-vm.sh
- ./scripts/update-vm.sh for SSH deploys from laptop

Full guide: docs/SETUP.md
Ops backlog: docs/OPS-AUTOMATION.md
EOF

echo ""
echo "Setup complete."
echo "  Secrets generated in .env (if placeholders were present): SESSION_SECRET, ENCRYPTION_KEY, INTERNAL_API_KEY"
echo "  Deploy reminders written to: $REMINDERS_FILE"
echo ""

if ((${#MISSING[@]} > 0)); then
  echo "Still required in .env:"
  for item in "${MISSING[@]}"; do
    echo "  - $item"
  done
  echo ""
fi

if ((${#WARNINGS[@]} > 0)); then
  echo "Warnings:"
  for item in "${WARNINGS[@]}"; do
    echo "  ! $item"
  done
  echo ""
fi

echo "GitHub Pages: set Actions variable VITE_API_URL (see $REMINDERS_FILE)"
echo ""
echo "Next: edit .env, then npm install && npm run db:migrate"
