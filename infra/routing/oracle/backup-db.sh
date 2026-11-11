#!/usr/bin/env bash
# Nightly dump of the server's database to ~/db-backups (kept 7 days). Installed in cron by deploy-api.sh:
#   15 2 * * *  ~/routing/oracle/backup-db.sh >> ~/db-backups/backup.log 2>&1
# Restore: docker compose exec -T postgres pg_restore --clean --if-exists --no-owner -U routify -d routify < FILE
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p ~/db-backups
file=~/db-backups/routify-$(date -u +%Y%m%dT%H%M%SZ).dump
docker compose exec -T postgres pg_dump --format=custom --no-owner --no-acl -U routify routify > "$file.part"
mv "$file.part" "$file"
find ~/db-backups -name 'routify-*.dump' -mtime +7 -delete
echo "$(date -u) backup ok: $file ($(du -h "$file" | cut -f1))"
