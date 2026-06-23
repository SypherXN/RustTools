#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=".env"
if [[ ! -f "$ENV_FILE" ]]; then
  cp .env.example "$ENV_FILE"
  echo "Created $ENV_FILE from .env.example"
fi

gen_secret() {
  openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64
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

mkdir -p data
echo "Setup complete. Edit .env with Discord credentials, then run: npm install && npm run db:migrate"
