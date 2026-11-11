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
  | "${SSH[@]}" 'set -e; rm -rf ~/deploy && mkdir ~/deploy && tar -x -C ~/deploy
    rm -rf ~/routing/backend-py && mv ~/deploy/backend-py ~/routing/backend-py
    cp ~/deploy/infra/routing/oracle/docker-compose.yml ~/deploy/infra/routing/oracle/Caddyfile ~/routing/oracle/
    rm -rf ~/deploy'

"${SSH[@]}" 'set -e; cd ~/routing/oracle
  docker compose build api
  docker compose up -d api caddy
  docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile
  for i in $(seq 1 40); do
    state=$(docker inspect -f "{{.State.Health.Status}}" "$(docker compose ps -q api)")
    [ "$state" = healthy ] && { echo "API is healthy"; exit 0; }
    sleep 5
  done
  docker compose logs --tail 60 api; echo "API did not become healthy" >&2; exit 1'
