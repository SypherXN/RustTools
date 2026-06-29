#!/usr/bin/env bash
# Poll RustTools /health and optionally alert an ops Discord webhook.
#
# Usage (on VM, from repo root):
#   ./scripts/health-watch.sh
#   ./scripts/health-watch.sh --quiet    # alert only on state change
#
# Environment (or .env in repo root):
#   HEALTH_URL                  Full URL (default: https://$DOMAIN/health)
#   DOMAIN                      Used when HEALTH_URL unset
#   OPS_DISCORD_WEBHOOK_URL     Discord webhook for ops alerts (optional)
#   OPS_HEALTH_STATE_FILE       State file for --quiet (default: ./data/ops-health-state.json)
#   OPS_NOTIFY_RECOVERY         If true, webhook when issues clear (default: false)
#   OPS_REQUIRE_RUSTPLUS        Exit non-zero when rustplus.connected is false (default: false)
#   OPS_CHECK_FCM_LISTENING     Exit non-zero when FCM configured but not listening (default: true)
#
# State-change-only alerts: use --quiet in cron (no duplicate webhooks while still broken).
# Recovery webhook when issues clear: OPS_NOTIFY_RECOVERY=true (requires --quiet).
#
# Cron example (every 10 minutes):
#   */10 * * * * cd /home/ubuntu/RustTools && ./scripts/health-watch.sh --quiet >>/tmp/rusttools-health-watch.log 2>&1
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

QUIET=false
for arg in "$@"; do
  case "$arg" in
    --quiet) QUIET=true ;;
    -h|--help)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown option: $arg (try --quiet)" >&2
      exit 2
      ;;
  esac
done

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

HEALTH_URL="${HEALTH_URL:-}"
if [[ -z "$HEALTH_URL" ]]; then
  DOMAIN="${DOMAIN:-}"
  if [[ -z "$DOMAIN" ]]; then
    echo "Set HEALTH_URL or DOMAIN in .env" >&2
    exit 2
  fi
  HEALTH_URL="https://${DOMAIN}/health"
fi

STATE_FILE="${OPS_HEALTH_STATE_FILE:-./data/ops-health-state.json}"
WEBHOOK="${OPS_DISCORD_WEBHOOK_URL:-}"
NOTIFY_RECOVERY="${OPS_NOTIFY_RECOVERY:-false}"
REQUIRE_RUSTPLUS="${OPS_REQUIRE_RUSTPLUS:-false}"
CHECK_FCM_LISTENING="${OPS_CHECK_FCM_LISTENING:-true}"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required (sudo apt install -y jq)" >&2
  exit 2
fi

issues=()
severity="ok"
exit_code=0
fcm_warning="false"
fcm_expired="false"

add_issue() {
  local level="$1"
  local msg="$2"
  issues+=("[$level] $msg")
  if [[ "$level" == "critical" ]]; then
    severity="critical"
    exit_code=1
  elif [[ "$level" == "warning" && "$severity" != "critical" ]]; then
    severity="warning"
  fi
}

body=""
if ! body="$(curl -fsS --max-time 30 "$HEALTH_URL" 2>&1)"; then
  add_issue "critical" "Health endpoint unreachable: $HEALTH_URL — $body"
else
  status="$(jq -r '.status // "missing"' <<<"$body")"
  if [[ "$status" != "ok" ]]; then
    add_issue "critical" "API status is '$status' (expected ok)"
  fi

  rp_connected="$(jq -r '.rustplus.connected // false' <<<"$body")"
  if [[ "$rp_connected" != "true" ]]; then
    add_issue "warning" "Rust+ is not connected (pairing may be needed or bot account offline)"
    if [[ "$REQUIRE_RUSTPLUS" == "true" ]]; then
      exit_code=1
      severity="critical"
    fi
  fi

  fcm_configured="$(jq -r '.fcm.configured // false' <<<"$body")"
  fcm_listening="$(jq -r '.fcm.listening // false' <<<"$body")"
  fcm_warning="$(jq -r '.fcm.warning // false' <<<"$body")"
  fcm_expired="$(jq -r '.fcm.expired // false' <<<"$body")"
  fcm_days="$(jq -r '.fcm.daysRemaining // "unknown"' <<<"$body")"
  fcm_expires="$(jq -r '.fcm.expiresAt // "unknown"' <<<"$body")"

  if [[ "$fcm_configured" != "true" ]]; then
    add_issue "warning" "FCM is not configured — upload fcm-config.json in Settings → Admin"
  elif [[ "$fcm_listening" != "true" && "$CHECK_FCM_LISTENING" == "true" ]]; then
    add_issue "critical" "FCM is configured but not listening — restart API or re-upload FCM config"
  fi

  if [[ "$fcm_expired" == "true" ]]; then
    add_issue "critical" "FCM credentials have expired — re-register and upload in Settings → Admin"
  elif [[ "$fcm_warning" == "true" ]]; then
    add_issue "warning" "FCM credentials expire in ${fcm_days} day(s) (expires ${fcm_expires}) — renew in Settings → Admin"
  fi
fi

state_key="${severity}"
if ((${#issues[@]} > 0)); then
  state_key="${severity}:$(printf '%s|' "${issues[@]}")"
fi

prev_key=""
if [[ -f "$STATE_FILE" ]]; then
  prev_key="$(jq -r '.stateKey // ""' "$STATE_FILE" 2>/dev/null || true)"
fi

should_notify=false
if [[ "$QUIET" == "true" ]]; then
  if [[ "$state_key" != "$prev_key" ]]; then
    should_notify=true
  fi
else
  if ((${#issues[@]} > 0)); then
    should_notify=true
  fi
fi

if [[ "$NOTIFY_RECOVERY" == "true" && "$QUIET" == "true" && -n "$prev_key" && "$prev_key" != "ok" && "$state_key" == "ok" ]]; then
  should_notify=true
  issues=("Recovery: all health checks passed")
  severity="ok"
fi

mkdir -p "$(dirname "$STATE_FILE")"
jq -n \
  --arg stateKey "$state_key" \
  --arg severity "$severity" \
  --arg checkedAt "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  --arg healthUrl "$HEALTH_URL" \
  '{stateKey: $stateKey, severity: $severity, checkedAt: $checkedAt, healthUrl: $healthUrl}' \
  >"$STATE_FILE"

if [[ -n "$WEBHOOK" && "$should_notify" == "true" ]]; then
  if ((${#issues[@]} == 0)); then
    content="RustTools ops: checks OK (${HEALTH_URL})"
  else
    content="RustTools ops alert (${severity})"
    content+=$'\n'"URL: ${HEALTH_URL}"
    for issue in "${issues[@]}"; do
      content+=$'\n'"• ${issue}"
    done
    if [[ "$fcm_warning" == "true" || "$fcm_expired" == "true" ]]; then
      content+=$'\n'"Renew FCM: npx @liamcottle/rustplus.js fcm-register --config-file=./data/fcm-config.json"
      content+=$'\n'"Then upload via Settings → Admin on the web dashboard."
    fi
  fi

  payload="$(jq -n --arg content "$content" '{content: $content}')"
  if ! curl -fsS -X POST "$WEBHOOK" \
    -H "Content-Type: application/json" \
    -d "$payload" >/dev/null; then
    echo "Discord webhook post failed" >&2
    exit_code=1
  fi
fi

if ((${#issues[@]} == 0)); then
  echo "OK: ${HEALTH_URL}"
else
  printf '%s\n' "${issues[@]}"
fi

exit "$exit_code"
