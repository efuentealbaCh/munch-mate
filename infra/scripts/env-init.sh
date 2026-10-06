#!/bin/sh
# Creates .env from .env.example, replacing each __HEX_<bytes>__ placeholder with a fresh random value.
# Usage: sh infra/scripts/env-init.sh [target-file]   (default: .env; refuses to overwrite)
set -eu

TARGET="${1:-.env}"

if [ -e "$TARGET" ]; then
  echo "✗ $TARGET already exists; delete it first if you really want new secrets." >&2
  exit 1
fi

# Each line is processed separately so every placeholder gets its own value.
while IFS= read -r line || [ -n "$line" ]; do
  while :; do
    case "$line" in
      *__HEX_*__*)
        bytes=$(printf '%s\n' "$line" | sed -E 's/.*__HEX_([0-9]+)__.*/\1/')
        value=$(openssl rand -hex "$bytes")
        line=$(printf '%s\n' "$line" | sed -E "s/__HEX_${bytes}__/${value}/")
        ;;
      *) break ;;
    esac
  done
  printf '%s\n' "$line"
done < .env.example > "$TARGET"

chmod 600 "$TARGET"
echo "✓ $TARGET created with random secrets."
