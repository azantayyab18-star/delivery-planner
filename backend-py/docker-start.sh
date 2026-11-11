#!/usr/bin/env sh
# Container start (see Dockerfile): apply database migrations, then run the worker (restarted if it exits) and the API.
# Migrations use DIRECT_URL (Neon's direct host); without it they use DATABASE_URL.
set -eu

echo "Applying database migrations"
DIRECT_URL="${DIRECT_URL:-$DATABASE_URL}" prisma migrate deploy

(while true; do python -m app.worker; echo 'worker exited; restarting in 5 s' >&2; sleep 5; done) &
exec python -m app --no-reload
