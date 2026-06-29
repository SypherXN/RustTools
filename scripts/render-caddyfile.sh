#!/usr/bin/env bash
# Render Caddyfile.generated from .env (DOMAIN = API host, optional WEB_DOMAIN = UI host).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

API_DOMAIN="${DOMAIN:?Set DOMAIN in .env (API hostname, e.g. rusttools-api.example.com)}"
WEB_DOMAIN="${WEB_DOMAIN:-}"
ACME="${ACME_EMAIL:-admin@localhost}"
OUT="${ROOT}/Caddyfile.generated"

{
  if [[ -n "$WEB_DOMAIN" ]]; then
    cat <<EOF
${WEB_DOMAIN} {
	email ${ACME}
	encode gzip
	root * /srv/web
	try_files {path} /index.html
	file_server
}

EOF
  fi

  cat <<EOF
${API_DOMAIN} {
	email ${ACME}
	encode gzip
	reverse_proxy api:3000
}

:80 {
	respond "RustTools — configure DOMAIN (and WEB_DOMAIN for UI) in .env" 200
}
EOF
} > "$OUT"

echo "Wrote ${OUT} (API=${API_DOMAIN}${WEB_DOMAIN:+, WEB=${WEB_DOMAIN}})"
