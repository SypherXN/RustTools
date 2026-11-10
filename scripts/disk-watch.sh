#!/usr/bin/env bash
# Alert when root or Docker filesystem usage exceeds a threshold.
#
# Usage (on VM, from repo root):
#   ./scripts/disk-watch.sh
#   ./scripts/disk-watch.sh --quiet    # alert only on state change
#
# Environment (or .env in repo root):
#   DISK_WARN_PCT               Warn when use% >= this (default: 85)
#   DISK_WATCH_MOUNTS           Space-separated mount points (default: / /var/lib/docker)
#   OPS_DISCORD_WEBHOOK_URL     Reuse ops webhook (optional)
#   OPS_DISK_STATE_FILE         State file for --quiet (default: ./data/ops-disk-state.json)
#
# Cron example (daily 04:00 UTC):
#   0 4 * * * cd /home/ubuntu/RustTools && ./scripts/disk-watch.sh --quiet >>/tmp/rusttools-disk-watch.log 2>&1
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

QUIET=false
for arg in "$@"; do
  case "$arg" in
    --quiet) QUIET=true ;;
    -h|--help)
      sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
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

DISK_WARN_PCT="${DISK_WARN_PCT:-85}"
DISK_WATCH_MOUNTS="${DISK_WATCH_MOUNTS:-/ /var/lib/docker}"
STATE_FILE="${OPS_DISK_STATE_FILE:-./data/ops-disk-state.json}"
WEBHOOK="${OPS_DISCORD_WEBHOOK_URL:-}"

if ! [[ "$DISK_WARN_PCT" =~ ^[0-9]+$ ]] || [[ "$DISK_WARN_PCT" -lt 1 ]] || [[ "$DISK_WARN_PCT" -gt 100 ]]; then
  echo "DISK_WARN_PCT must be 1–100" >&2
  exit 2
fi

issues=()
severity="ok"
exit_code=0

check_mount() {
  local mount="$1"
  local line used avail pct
  if ! line="$(df -P "$mount" 2>/dev/null | tail -1)"; then
    return 0
  fi
  used="$(awk '{print $3}' <<<"$line")"
  avail="$(awk '{print $4}' <<<"$line")"
  pct="$(awk '{print $5}' <<<"$line" | tr -d '%')"
  if [[ -z "$pct" || ! "$pct" =~ ^[0-9]+$ ]]; then
    return 0
  fi
  if [[ "$pct" -ge "$DISK_WARN_PCT" ]]; then
    issues+=("[warning] ${mount} is ${pct}% full (${used}K used, ${avail}K avail)")
    severity="warning"
    exit_code=1
  else
    echo "OK: ${mount} at ${pct}%"
  fi
}

for mount in $DISK_WATCH_MOUNTS; do
  check_mount "$mount"
done

state_key="${severity}"
if ((${#issues[@]} > 0)); then
  state_key="${severity}:$(printf '%s|' "${issues[@]}")"
fi

prev_key=""
if [[ -f "$STATE_FILE" ]]; then
  if command -v jq >/dev/null 2>&1; then
    prev_key="$(jq -r '.stateKey // ""' "$STATE_FILE" 2>/dev/null || true)"
  else
    prev_key="$(grep -o '"stateKey":"[^"]*"' "$STATE_FILE" 2>/dev/null | head -1 | cut -d'"' -f4 || true)"
  fi
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

mkdir -p "$(dirname "$STATE_FILE")"
if command -v jq >/dev/null 2>&1; then
  jq -n \
    --arg stateKey "$state_key" \
    --arg severity "$severity" \
    --arg checkedAt "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    '{stateKey: $stateKey, severity: $severity, checkedAt: $checkedAt}' \
    >"$STATE_FILE"
else
  printf '{"stateKey":"%s","severity":"%s","checkedAt":"%s"}\n' \
    "$state_key" "$severity" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" >"$STATE_FILE"
fi

if [[ -n "$WEBHOOK" && "$should_notify" == "true" && ${#issues[@]} -gt 0 ]]; then
  content="RustTools ops: disk space alert"
  for issue in "${issues[@]}"; do
    content+=$'\n'"• ${issue}"
  done
  content+=$'\n'"Suggestions: docker system prune -f; remove old ~/backups/rusttools-*.tar.gz; prune procgen uploads in Admin"
  if ! command -v jq >/dev/null 2>&1; then
    echo "jq required for Discord webhook (sudo apt install -y jq)" >&2
    exit_code=1
  else
    payload="$(jq -n --arg content "$content" '{content: $content}')"
    if ! curl -fsS -X POST "$WEBHOOK" \
      -H "Content-Type: application/json" \
      -d "$payload" >/dev/null; then
      echo "Discord webhook post failed" >&2
      exit_code=1
    fi
  fi
fi

if ((${#issues[@]} > 0)); then
  printf '%s\n' "${issues[@]}"
fi

exit "$exit_code"
