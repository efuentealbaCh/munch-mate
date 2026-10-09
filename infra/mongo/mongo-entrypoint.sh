#!/bin/bash
# Wraps the official mongo entrypoint to provide the keyfile required when auth and a replica set are combined.
# The keyfile lives in the mongo_config volume, so it is generated once and survives restarts.
# For a multi-node replica set, every member must share the same keyfile: copy it instead of generating it.
set -euo pipefail

KEYFILE=/data/configdb/keyfile

if [ ! -f "$KEYFILE" ]; then
  head -c 756 /dev/urandom | base64 -w 0 > "$KEYFILE"
fi
# mongod refuses keyfiles readable by others; 999 is the mongodb user in the official image.
chmod 400 "$KEYFILE"
chown 999:999 "$KEYFILE"

exec docker-entrypoint.sh "$@"
