#!/bin/sh
# Grants (or with --revoke, removes) the platform admin role to an existing account.
# Usage: sh infra/scripts/platform-admin.sh [--revoke] <email>   (from the repo root, stack running)
# Works for both the dev infra and the production stack: they share the compose project and the mongo service.
# The user must log in again (or reload /plataforma) to see the admin area; the api checks the role on every
# request, so a revocation takes effect immediately.
set -eu
export MSYS_NO_PATHCONV=1

ROLE="admin"
if [ "${1:-}" = "--revoke" ]; then
  ROLE=""
  shift
fi
EMAIL=$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')
if [ -z "$EMAIL" ]; then
  echo "Usage: sh infra/scripts/platform-admin.sh [--revoke] <email>" >&2
  exit 2
fi

# The email and role travel as environment variables (never interpolated into the script), and the root
# credentials are read inside the container, so nothing sensitive shows up in the host's process list.
docker compose -f compose.yaml exec -T -e TARGET_EMAIL="$EMAIL" -e TARGET_ROLE="$ROLE" mongo sh -c '
  mongosh --quiet -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin "$MONGO_DB" --eval "
    const email = process.env.TARGET_EMAIL;
    const role = process.env.TARGET_ROLE || null;
    const result = db.users.updateOne({ email }, { \$set: { platformRole: role } });
    if (result.matchedCount === 0) { print(\"✗ no account with email \" + email); quit(1); }
    print(role ? \"✓ \" + email + \" is now a platform admin\" : \"✓ platform admin role removed from \" + email);
  "'
