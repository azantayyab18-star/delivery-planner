#!/usr/bin/env bash
# Copies the whole database from one Postgres to another (schema + data), replacing what the target has. Runs on the
# Oracle server, in this folder. Stop the API first so nothing is written during the copy:
#
#   docker compose stop api
#   ./move-db.sh "$NEON_DIRECT_URL" "postgresql://routify:<DB_PASSWORD>@postgres:5432/routify"   # Neon -> this server
#   ./move-db.sh "postgresql://routify:<DB_PASSWORD>@postgres:5432/routify" "$NEON_DIRECT_URL"   # back to Neon (or any Postgres 18)
#   (then point DATABASE_URL / DIRECT_URL in api.env at the target and: docker compose up -d api)
#
# Use direct (not pooled) URLs. The source is only read. A dump of the target is saved first in ~/db-backups.
set -euo pipefail
cd "$(dirname "$0")"
FROM="${1:?source database URL}"
TO="${2:?target database URL}"
NET="$(basename "$PWD")_default"
mkdir -p ~/db-backups
PG=(docker run --rm -i --network "$NET" postgres:18)

stamp=$(date -u +%Y%m%dT%H%M%SZ)
echo "Saving the target's current data to ~/db-backups/before-move-$stamp.dump"
"${PG[@]}" pg_dump --format=custom --no-owner --no-acl "$TO" > ~/db-backups/before-move-"$stamp".dump || true

echo "Copying"
"${PG[@]}" pg_dump --format=custom --no-owner --no-acl "$FROM" > ~/db-backups/move-"$stamp".dump
"${PG[@]}" pg_restore --clean --if-exists --no-owner --no-acl --single-transaction --dbname "$TO" < ~/db-backups/move-"$stamp".dump

echo "Row counts (source | target):"
q="select string_agg(relname || '=' || n_live_tup, ' ' order by relname) from pg_stat_user_tables"
for url in "$FROM" "$TO"; do "${PG[@]}" psql "$url" -Atc "analyze" >/dev/null; "${PG[@]}" psql "$url" -Atc "$q"; done
echo "Done"
