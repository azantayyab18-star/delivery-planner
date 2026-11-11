#!/usr/bin/env bash
# Deploys the committed backend-py (and this folder's compose + Caddy files) to the Oracle server, then rebuilds and
# restarts the API. Run from the repo, in Git Bash:
#
#   infra/routing/oracle/deploy-api.sh                 # ORACLE_KEY / ORACLE_HOST below, or set them in the environment
#
# Only committed files are sent (git archive HEAD); .env files never leave this PC. The server keeps its own api.env.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

KEY="${ORACLE_KEY:-/d/oracle-ssh/ssh-key-2026-11-05 (1).key}"
HOST="${ORACLE_HOST:-ubuntu@193.123.75.88}"
SSH=(ssh -i "$KEY" -o ConnectTimeout=20 "$HOST")

echo "Sending $(git rev-parse --short HEAD) to $HOST"
git archive HEAD backend-py infra/routing/oracle/docker-compose.yml infra/routing/oracle/Caddyfile \
    infra/routing/oracle/backup-db.sh infra/routing/oracle/move-db.sh \
  | "${SSH[@]}" 'set -e; rm -rf ~/deploy && mkdir ~/deploy && tar -x -C ~/deploy
    rm -rf ~/routing/backend-py && mv ~/deploy/backend-py ~/routing/backend-py
    cp ~/deploy/infra/routing/oracle/{docker-compose.yml,Caddyfile,backup-db.sh,move-db.sh} ~/routing/oracle/
    rm -rf ~/deploy
    # Nightly database backup (02:15 UTC), added once.
    crontab -l 2>/dev/null | grep -q backup-db.sh || \
      (crontab -l 2>/dev/null; echo "15 2 * * * ~/routing/oracle/backup-db.sh >> ~/db-backups/backup.log 2>&1") | crontab -'

"${SSH[@]}" 'set -e; cd ~/routing/oracle
  docker compose build api
  docker compose up -d postgres api caddy
  docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile
  for i in $(seq 1 40); do
    state=$(docker inspect -f "{{.State.Health.Status}}" "$(docker compose ps -q api)")
    [ "$state" = healthy ] && { echo "API is healthy"; exit 0; }
    sleep 5
  done
  docker compose logs --tail 60 api; echo "API did not become healthy" >&2; exit 1'
