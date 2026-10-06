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
if [ "$DOMAIN" = "localhost" ]; then
  # Local stack: Caddy's internal CA is not trusted by the host, and s3.localhost may not resolve.
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

echo
if [ "$failures" -gt 0 ]; then
  echo "✗ $failures check(s) failed"
  exit 1
fi
echo "✓ all checks passed"
