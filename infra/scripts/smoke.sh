#!/bin/sh
# Release gate: verifies the production stack end to end, through Caddy and TLS.
# Runs against `pnpm stack:up` locally (DOMAIN=localhost) and on the VPS after each deploy.
# Usage: sh infra/scripts/smoke.sh   (from the repo root; reads .env)
set -eu
# Unlike the other scripts, no MSYS_NO_PATHCONV here: no absolute container paths are passed, and on
# Git Bash curl needs /tmp and /dev/null translated to Windows paths.

set -a
. ./.env
set +a

COMPOSE="docker compose -f compose.yaml -f compose.prod.yaml"
EXPECTED_SERVICES="api caddy garage mongo valkey web workers"
BASE="https://$DOMAIN"
S3_URL="https://s3.$DOMAIN/$S3_BUCKET/smoke-$(date +%s).txt"

CURL="curl -sS --max-time 15"
LOCAL=false
if [ "$DOMAIN" = "localhost" ]; then
  LOCAL=true
  # Local release gate (compose.local.yaml): emails go to a Mailpit container.
  COMPOSE="$COMPOSE -f compose.local.yaml"
  EXPECTED_SERVICES="$EXPECTED_SERVICES mailpit"
  # Caddy's internal CA is not trusted by the host, and s3.localhost may not resolve.
  CURL="$CURL -k --resolve s3.localhost:443:127.0.0.1"
fi
SIGNED="--aws-sigv4 aws:amz:$S3_REGION:s3 --user $S3_ACCESS_KEY_ID:$S3_SECRET_ACCESS_KEY -H x-amz-content-sha256:UNSIGNED-PAYLOAD"

failures=0
pass() { echo "✓ $1"; }
fail() {
  echo "✗ $1"
  failures=$((failures + 1))
}

# HTTP status code of a request; extra args are passed to curl.
status() { $CURL -o /dev/null -w '%{http_code}' "$@" || true; }

echo "Smoke test against $BASE"

# 1. Every service is running and healthy.
for service in $EXPECTED_SERVICES; do
  health=$($COMPOSE ps --format '{{.Health}}' "$service" 2>/dev/null || true)
  if [ "$health" = "healthy" ]; then pass "$service healthy"; else fail "$service health is '${health:-missing}'"; fi
done

# 2. Plain HTTP redirects to HTTPS.
code=$(status "http://$DOMAIN/")
if [ "$code" = "308" ] || [ "$code" = "301" ]; then pass "http redirects to https ($code)"; else fail "http → https redirect returned $code"; fi

# 3. Web is served through Caddy.
if $CURL "$BASE/" | grep -q "Munch Mate"; then pass "web home page"; else fail "web home page"; fi

# 4. /api/* reaches NestJS and its dependencies are up.
body=$($CURL "$BASE/api/health" || true)
case "$body" in
  *'"status":"ok"'*) pass "api health ok" ;;
  *) fail "api health: $body" ;;
esac
code=$(status "$BASE/api/does-not-exist")
if [ "$code" = "404" ]; then pass "unknown /api route answered by api (404)"; else fail "unknown /api route returned $code"; fi

# 5. Object storage through s3.<domain>: signed requests work, anonymous ones are denied.
tmp_file=$(mktemp)
echo "smoke $(date)" > "$tmp_file"
# shellcheck disable=SC2086 # SIGNED holds several curl flags.
code=$(status $SIGNED -T "$tmp_file" "$S3_URL")
if [ "$code" = "200" ]; then pass "s3 signed upload"; else fail "s3 signed upload returned $code"; fi
# shellcheck disable=SC2086
if $CURL $SIGNED "$S3_URL" | cmp -s - "$tmp_file"; then pass "s3 signed download matches"; else fail "s3 signed download"; fi
code=$(status "$S3_URL")
if [ "$code" = "403" ]; then pass "s3 anonymous access denied (403)"; else fail "s3 anonymous access returned $code (bucket must be private)"; fi
# shellcheck disable=SC2086
$CURL $SIGNED -X DELETE -o /dev/null "$S3_URL" || true
rm -f "$tmp_file"

# 6. A job travels producer → Valkey → workers and back, inside the production network.
if $COMPOSE exec -T workers node - << 'EOF'
const { Queue, QueueEvents } = require("bullmq");
(async () => {
  const connection = { url: process.env.VALKEY_URL };
  const queue = new Queue("system", { connection });
  const events = new QueueEvents("system", { connection });
  await events.waitUntilReady();
  // removeOnComplete must not be immediate: a fast worker would delete the job before waitUntilFinished reads it.
  const job = await queue.add("ping", { sentAt: new Date().toISOString() }, { removeOnComplete: { age: 300 } });
  const result = await job.waitUntilFinished(events, 10000);
  await Promise.all([queue.close(), events.close()]);
  process.exit(result && result.pong === true ? 0 : 1);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
EOF
then pass "queue round trip (system:ping)"; else fail "queue round trip (system:ping)"; fi

# 7. Auth through Caddy. Safe everywhere: no data is created and no email is sent.
body=$($CURL "$BASE/api/auth/me" || true)
case "$body" in
  *'"UNAUTHENTICATED"'*) pass "protected route without session → 401" ;;
  *) fail "protected route without session: $body" ;;
esac
body=$($CURL -H "Origin: $BASE" -H "Content-Type: application/json" \
  -d '{"email":"smoke-nobody@example.com","password":"wrong-password"}' "$BASE/api/auth/login" || true)
case "$body" in
  *'"INVALID_CREDENTIALS"'*) pass "login with unknown account → 401" ;;
  *) fail "login with unknown account: $body" ;;
esac
code=$(status -H "Origin: https://evil.example" -H "Content-Type: application/json" -d '{}' "$BASE/api/auth/login")
if [ "$code" = "403" ]; then pass "cross-origin POST rejected (403)"; else fail "cross-origin POST returned $code"; fi

# 8. Full registration flow — local stack only (creates a user and sends an email to Mailpit).
if [ "$LOCAL" = true ]; then
  jar=$(mktemp)
  headers=$(mktemp)
  email="smoke-$(date +%s)@example.com"
  code=$($CURL -o /dev/null -w '%{http_code}' -c "$jar" -D "$headers" -H "Origin: $BASE" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"smoke test password\",\"name\":\"Smoke\"}" \
    "$BASE/api/auth/register" || true)
  if [ "$code" = "201" ]; then pass "register through Caddy (201)"; else fail "register returned $code"; fi

  if grep -i '^set-cookie: mm_at=' "$headers" | grep -qi 'secure' && grep -i '^set-cookie: mm_at=' "$headers" | grep -qi 'httponly'; then
    pass "session cookie is Secure + HttpOnly"
  else
    fail "session cookie flags: $(grep -i '^set-cookie: mm_at=' "$headers" | cut -c1-120)"
  fi

  code=$(status -b "$jar" "$BASE/api/auth/me")
  if [ "$code" = "200" ]; then pass "session cookie authenticates /api/auth/me"; else fail "/api/auth/me with session returned $code"; fi

  delivered=false
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    if curl -sS --max-time 5 "http://127.0.0.1:8025/api/v1/search?query=to:$email" | grep -q '"total":[1-9]'; then
      delivered=true
      break
    fi
    sleep 1
  done
  if [ "$delivered" = true ]; then pass "verification email delivered (Mailpit)"; else fail "verification email not delivered within 15s"; fi

  # Follow the emailed link like a user would: read the token from Mailpit and verify.
  message_id=$(curl -sS "http://127.0.0.1:8025/api/v1/search?query=to:$email" | sed -n 's/.*"ID":"\([^"]*\)".*/\1/p' | head -1)
  token=$(curl -sS "http://127.0.0.1:8025/api/v1/message/$message_id" | grep -o 'token=[A-Za-z0-9_-]*' | head -1 | cut -d= -f2)
  code=$(status -H "Origin: $BASE" -H "Content-Type: application/json" -d "{\"token\":\"$token\"}" "$BASE/api/auth/verify-email")
  if [ "$code" = "204" ]; then pass "email verified with the emailed link"; else fail "verify-email returned $code"; fi

  # Phase 1b: a verified owner creates a restaurant and invites staff.
  body=$($CURL -b "$jar" -H "Origin: $BASE" -H "Content-Type: application/json" \
    -d '{"name":"Smoke Pic\u00e1"}' "$BASE/api/restaurants" || true)
  # JSON escape instead of the literal accented letter: Git Bash on Windows hands non-ASCII arguments to curl in the console code page, not UTF-8.
  restaurant_id=$(printf '%s' "$body" | sed -n 's/.*"id":"\([0-9a-f]\{24\}\)".*/\1/p')
  case "$body" in
    *'"slug":"smoke-pica'*'"myRoles":["owner"]'*) pass "restaurant created with generated slug" ;;
    *) fail "create restaurant: $body" ;;
  esac

  staff="smoke-staff-$(date +%s)@example.com"
  code=$(status -b "$jar" -H "Origin: $BASE" -H "Content-Type: application/json" \
    -d "{\"email\":\"$staff\",\"roles\":[\"kitchen\"]}" "$BASE/api/restaurants/$restaurant_id/invitations")
  if [ "$code" = "201" ]; then pass "staff invited (201)"; else fail "invite returned $code"; fi
  delivered=false
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    if curl -sS --max-time 5 "http://127.0.0.1:8025/api/v1/search?query=to:$staff" | grep -q '"total":[1-9]'; then
      delivered=true
      break
    fi
    sleep 1
  done
  if [ "$delivered" = true ]; then pass "invitation email delivered (Mailpit)"; else fail "invitation email not delivered within 15s"; fi

  code=$(status "$BASE/api/restaurants/$restaurant_id")
  if [ "$code" = "401" ]; then pass "restaurant requires a session (401)"; else fail "anonymous restaurant read returned $code"; fi
  rm -f "$jar" "$headers"
fi

echo
if [ "$failures" -gt 0 ]; then
  echo "✗ $failures check(s) failed"
  exit 1
fi
echo "✓ all checks passed"
