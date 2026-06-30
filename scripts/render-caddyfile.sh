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
  # Caddy v2: email belongs in the global options block, not inside site blocks.
  cat <<EOF
{
	email ${ACME}
}

EOF

  if [[ -n "$WEB_DOMAIN" ]]; then
    cat <<EOF
${WEB_DOMAIN} {
	encode gzip
	root * /srv/web
	try_files {path} /index.html
	file_server
}

EOF
  fi

  cat <<EOF
${API_DOMAIN} {
	encode gzip
	reverse_proxy api:3000 {
		transport http {
			read_timeout 2m
			write_timeout 2m
		}
	}
}

:80 {
	respond "RustTools — configure DOMAIN (and WEB_DOMAIN for UI) in .env" 200
}
EOF
} > "$OUT"

echo "Wrote ${OUT} (API=${API_DOMAIN}${WEB_DOMAIN:+, WEB=${WEB_DOMAIN}})"
