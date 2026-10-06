#!/bin/sh
# Dumps MongoDB to a gzipped archive and keeps the most recent ones.
# Usage: sh infra/scripts/backup.sh [backup-dir]   (from the repo root; default dir: backups/)
# VPS cron (daily at 03:00):
#   0 3 * * * cd /opt/munch-mate && sh infra/scripts/backup.sh >> backups/backup.log 2>&1
# Copy the archives off the VPS afterwards (rclone/restic): a backup on the same disk is not a backup.
set -eu
export MSYS_NO_PATHCONV=1

BACKUP_DIR="${1:-backups}"
KEEP="${BACKUP_KEEP:-14}"
COMPOSE="docker compose -f compose.yaml -f compose.prod.yaml"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
TARGET="$BACKUP_DIR/mongo-$TIMESTAMP.archive.gz"

mkdir -p "$BACKUP_DIR"

# Credentials are read inside the container, so they never appear in the host's process list.
$COMPOSE exec -T mongo sh -c \
  'mongodump --quiet --archive --gzip -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin' \
  > "$TARGET.partial"
mv "$TARGET.partial" "$TARGET"
echo "✓ $(date -Iseconds) $TARGET ($(du -h "$TARGET" | cut -f1))"

# Retention: keep the newest $KEEP archives.
ls -1t "$BACKUP_DIR"/mongo-*.archive.gz | tail -n +"$((KEEP + 1))" | while read -r old; do
  rm -f -- "$old"
  echo "  removed $old"
done
