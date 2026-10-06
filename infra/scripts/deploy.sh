#!/bin/sh
# Deploys a commit that CI already built and pushed to the registry.
# Usage: DEPLOY_HOST=user@vps sh infra/scripts/deploy.sh <git-sha>
#   Optional: DEPLOY_PATH (default /opt/munch-mate).
# The VPS keeps a clone of this repo (compose files, Caddyfile, scripts) and its own .env.
# Rollback = run this again with the previous SHA.
set -eu

SHA="${1:?usage: DEPLOY_HOST=user@vps $0 <git-sha>}"
HOST="${DEPLOY_HOST:?set DEPLOY_HOST=user@vps}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/munch-mate}"

echo "Deploying $SHA to $HOST:$DEPLOY_PATH"

# shellcheck disable=SC2087 # variables are expanded locally on purpose.
ssh "$HOST" sh -eu << EOF
cd "$DEPLOY_PATH"
git fetch --quiet origin
git checkout --quiet --detach "$SHA"

# Persist the tag so restarts and reboots keep running this version.
sed -i "s/^TAG=.*/TAG=$SHA/" .env

COMPOSE="docker compose -f compose.yaml -f compose.prod.yaml"
\$COMPOSE pull --quiet api workers web
\$COMPOSE up -d --no-build --wait --remove-orphans
sh infra/scripts/smoke.sh
docker image prune -f > /dev/null
EOF

echo "✓ $SHA deployed"
