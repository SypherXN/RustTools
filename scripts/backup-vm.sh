#!/usr/bin/env bash
# Back up the RustTools Docker data volume (SQLite, FCM config, procgen files).
#
# Usage (on VM, from repo root):
#   ./scripts/backup-vm.sh
#   ./scripts/backup-vm.sh --restore ~/backups/rusttools-20260629-1200.tar.gz
#
# Environment (or .env in repo root):
#   BACKUP_DIR                  Output directory (default: ~/backups)
#   BACKUP_RETENTION_DAYS       Delete backups older than N days (default: 28)
#   BACKUP_PAUSE_API            If true, stop api/discord-bot during backup (default: false)
#   BACKUP_REMOTE               Optional rclone destination (e.g. remote:rusttools-backups)
#
# SQLite note: backups are usually safe while the API is running (WAL mode). For maximum
# consistency before a major upgrade, set BACKUP_PAUSE_API=true or run:
#   docker compose stop api discord-bot && ./scripts/backup-vm.sh && docker compose start api discord-bot
#
# Cron example (weekly, Sunday 03:15 UTC):
#   15 3 * * 0 cd /home/ubuntu/RustTools && ./scripts/backup-vm.sh >>/tmp/rusttools-backup.log 2>&1
#
# Optional off-site copy (install rclone, configure remote first):
#   BACKUP_REMOTE=gdrive:RustTools/backups ./scripts/backup-vm.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODE=backup
RESTORE_ARCHIVE=""

for arg in "$@"; do
  case "$arg" in
    --restore)
      MODE=restore
      ;;
    -h|--help)
      sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      if [[ "$MODE" == "restore" && -z "$RESTORE_ARCHIVE" ]]; then
        RESTORE_ARCHIVE="$arg"
      elif [[ "$MODE" == "restore" ]]; then
        echo "Unexpected argument: $arg" >&2
        exit 2
      else
        echo "Unknown option: $arg (try --help or --restore <archive>)" >&2
        exit 2
      fi
      ;;
  esac
done

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [[ ! -f docker-compose.yml ]]; then
  echo "Run this from the RustTools repo root (expected docker-compose.yml)." >&2
  exit 1
fi

BACKUP_DIR="${BACKUP_DIR:-$HOME/backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-28}"
BACKUP_PAUSE_API="${BACKUP_PAUSE_API:-false}"
BACKUP_REMOTE="${BACKUP_REMOTE:-}"

resolve_data_volume() {
  local volume
  volume="$(docker volume ls --format '{{.Name}}' | grep -E 'rusttools-data$' | head -1 || true)"
  if [[ -z "$volume" ]]; then
    echo "Could not find Docker volume ending in rusttools-data." >&2
    echo "Is the stack running? Try: docker compose up -d" >&2
    echo "Volumes:" >&2
    docker volume ls >&2 || true
    exit 1
  fi
  printf '%s' "$volume"
}

restart_api_if_paused() {
  if [[ "${PAUSED_API:-false}" == "true" ]]; then
    echo "==> Starting api and discord-bot..."
    docker compose start api discord-bot
  fi
}

if [[ "$MODE" == "restore" ]]; then
  if [[ -z "$RESTORE_ARCHIVE" ]]; then
    echo "Usage: $0 --restore /path/to/rusttools-YYYYMMDD-HHMM.tar.gz" >&2
    exit 2
  fi
  if [[ ! -f "$RESTORE_ARCHIVE" ]]; then
    echo "Archive not found: $RESTORE_ARCHIVE" >&2
    exit 1
  fi

  VOLUME="$(resolve_data_volume)"
  echo "==> Restoring $RESTORE_ARCHIVE into volume $VOLUME"
  echo "    This replaces all files in /app/data. Stop the API first if it is running."
  read -r -p "Continue? [y/N] " confirm
  if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
    echo "Aborted."
    exit 1
  fi

  echo "==> Stopping api and discord-bot..."
  docker compose stop api discord-bot

  docker run --rm \
    -v "${VOLUME}:/data" \
    -v "$(dirname "$(realpath "$RESTORE_ARCHIVE")"):/backup:ro" \
    alpine:3.20 \
    sh -c "cd /data && find . -mindepth 1 -maxdepth 1 -exec rm -rf {} + && tar xzf /backup/$(basename "$RESTORE_ARCHIVE")"

  echo "==> Starting api and discord-bot..."
  docker compose start api discord-bot
  echo "Restore complete."
  exit 0
fi

VOLUME="$(resolve_data_volume)"
STAMP="$(date -u +"%Y%m%d-%H%M")"
ARCHIVE="${BACKUP_DIR}/rusttools-${STAMP}.tar.gz"

mkdir -p "$BACKUP_DIR"

PAUSED_API=false
cleanup_pause() {
  restart_api_if_paused
}
trap cleanup_pause EXIT

if [[ "$BACKUP_PAUSE_API" == "true" ]]; then
  echo "==> Pausing api and discord-bot for consistent backup..."
  docker compose stop api discord-bot
  PAUSED_API=true
fi

echo "==> Backing up volume $VOLUME to $ARCHIVE"
docker run --rm \
  -v "${VOLUME}:/data:ro" \
  -v "${BACKUP_DIR}:/backup" \
  alpine:3.20 \
  tar czf "/backup/rusttools-${STAMP}.tar.gz" -C /data .

SIZE="$(du -h "$ARCHIVE" | cut -f1)"
echo "Backup created: $ARCHIVE ($SIZE)"

if [[ "$BACKUP_RETENTION_DAYS" =~ ^[0-9]+$ ]] && [[ "$BACKUP_RETENTION_DAYS" -gt 0 ]]; then
  echo "==> Pruning backups older than ${BACKUP_RETENTION_DAYS} days in $BACKUP_DIR"
  find "$BACKUP_DIR" -maxdepth 1 -type f -name 'rusttools-*.tar.gz' -mtime "+${BACKUP_RETENTION_DAYS}" -print -delete || true
fi

if [[ -n "$BACKUP_REMOTE" ]]; then
  if command -v rclone >/dev/null 2>&1; then
    echo "==> Copying to $BACKUP_REMOTE"
    rclone copy "$ARCHIVE" "$BACKUP_REMOTE/"
  else
    echo "BACKUP_REMOTE is set but rclone is not installed — local backup only." >&2
    echo "Install: https://rclone.org/install/" >&2
  fi
fi

echo "Done."
