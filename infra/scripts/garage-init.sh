#!/bin/sh
# One-time Garage setup for an environment: assigns the node layout, imports the app key from .env,
# creates the bucket and grants the key access to it. Idempotent: safe to run again.
# Usage: sh infra/scripts/garage-init.sh <compose file>...   (run from the repo root, garage must be running)
set -eu
# Git Bash on Windows would otherwise rewrite "/garage" into a Windows path.
export MSYS_NO_PATHCONV=1

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <compose file>..." >&2
  exit 1
fi

COMPOSE_ARGS=""
for file in "$@"; do COMPOSE_ARGS="$COMPOSE_ARGS -f $file"; done

set -a
. ./.env
set +a

garage() {
  # shellcheck disable=SC2086 # COMPOSE_ARGS is intentionally split into separate -f flags.
  docker compose $COMPOSE_ARGS exec -T -e RUST_LOG=warn garage /garage "$@"
}

# 1. Layout: a node stores nothing until it has a role in the cluster layout.
if garage layout show | grep -q "No nodes currently have a role"; then
  node_id=$(garage node id -q | cut -c1-16)
  version=$(garage layout show | sed -n 's/.*Current cluster layout version: \([0-9]*\).*/\1/p')
  garage layout assign -z dc1 -c "${GARAGE_CAPACITY:-10G}" "$node_id"
  garage layout apply --version "$((version + 1))"
  echo "✓ layout applied (node $node_id, capacity ${GARAGE_CAPACITY:-10G})"
else
  echo "• layout already applied"
fi

# 2. App key: imported with the credentials from .env, so the apps and Garage always agree.
if garage key info "$S3_ACCESS_KEY_ID" > /dev/null 2>&1; then
  echo "• key $S3_ACCESS_KEY_ID already exists"
else
  garage key import --yes -n munchmate-app "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" > /dev/null
  echo "✓ key $S3_ACCESS_KEY_ID imported"
fi

# 3. Bucket (private: no website access, only signed requests).
if garage bucket info "$S3_BUCKET" > /dev/null 2>&1; then
  echo "• bucket $S3_BUCKET already exists"
else
  garage bucket create "$S3_BUCKET" > /dev/null
  echo "✓ bucket $S3_BUCKET created"
fi

# 4. Permissions (idempotent).
garage bucket allow --read --write --owner "$S3_BUCKET" --key "$S3_ACCESS_KEY_ID" > /dev/null
echo "✓ key has read/write/owner on $S3_BUCKET"
