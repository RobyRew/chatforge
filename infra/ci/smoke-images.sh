#!/usr/bin/env bash
# Runs only on an ephemeral CI runner. No production values or volumes are used.
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true ]] || { echo 'Requires a disposable CI runner' >&2; exit 1; }
umask 077
work=$(mktemp -d)
project="cf-ci-$(openssl rand -hex 6)"
export CHATFORGE_POSTGRES_VOLUME="$project-postgres"
export CHATFORGE_POSTGRES_IMAGE=chatforge-postgres:ci CHATFORGE_GARAGE_IMAGE=chatforge-garage:ci
export CHATFORGE_API_IMAGE=chatforge-api:ci CHATFORGE_WEB_IMAGE=chatforge-web:ci
export POSTGRES_USER=chatforge POSTGRES_DB=chatforge POSTGRES_PASSWORD
POSTGRES_PASSWORD=$(openssl rand -hex 32)
export DATABASE_URL="postgres://chatforge:$POSTGRES_PASSWORD@postgres:5432/chatforge"
export GARAGE_RPC_SECRET S3_ACCESS_KEY S3_SECRET_KEY
GARAGE_RPC_SECRET=$(openssl rand -hex 32)
S3_ACCESS_KEY="GK$(openssl rand -hex 12)"
S3_SECRET_KEY=$(openssl rand -hex 32)
export S3_BUCKET=qa-chatforge
export LOGTO_ENDPOINT=https://identity.invalid LOGTO_APP_ID=qa-chatforge LOGTO_APP_SECRET
LOGTO_APP_SECRET=$(openssl rand -hex 32)
export APP_BASE_URL=http://127.0.0.1:18980 CORS_ORIGIN=http://127.0.0.1:18980
export ADMIN_EMAIL=''
export SPOTIFY_CLIENT_ID=''
export SPOTIFY_CLIENT_SECRET=''
export BLOB_QUOTA_BYTES=536870912
touch "$work/empty.env"
compose=(docker compose --project-name "$project" --env-file "$work/empty.env"
  -f docker-compose.production.yml -f infra/ci/compose.yml)
network_created=0
volume_created=0
cleanup() {
  "${compose[@]}" down --volumes --timeout 20 >/dev/null 2>&1 || true
  if [[ "$volume_created" = 1 ]]; then docker volume rm "$CHATFORGE_POSTGRES_VOLUME" >/dev/null; fi
  if [[ "$network_created" = 1 ]]; then docker network rm dokploy-network >/dev/null; fi
  rm -rf -- "$work"
}
trap cleanup EXIT
if docker network inspect dokploy-network >/dev/null 2>&1; then
  echo 'Refusing to use a pre-existing production-named network' >&2
  exit 1
fi
docker network create --label chatforge.test="$project" dokploy-network >/dev/null
network_created=1
docker volume create --label chatforge.test="$project" "$CHATFORGE_POSTGRES_VOLUME" >/dev/null
volume_created=1
"${compose[@]}" config --quiet
"${compose[@]}" config --format json | python3 infra/check-production.py --ci
"${compose[@]}" up --detach --wait --wait-timeout 180

# Assert the same non-root/read-only/capability/memory settings used by production.
for service in postgres garage api web; do
  container=$("${compose[@]}" ps --quiet "$service")
  test -n "$container"
  docker inspect "$container" | jq -e '.[0] |
    .Config.User != "" and .Config.User != "root" and .Config.User != "0" and
    .HostConfig.ReadonlyRootfs and (.HostConfig.CapDrop | index("ALL") != null) and
    (.HostConfig.SecurityOpt | index("no-new-privileges:true") != null) and
    .HostConfig.Memory > 0 and (.State.OOMKilled | not)' >/dev/null
done
export S3_TEST_ENDPOINT=http://127.0.0.1:13900 S3_TEST_BUCKET="$S3_BUCKET"
export S3_TEST_ACCESS_KEY="$S3_ACCESS_KEY" S3_TEST_SECRET_KEY="$S3_SECRET_KEY"
export S3_TEST_CONTAINER
S3_TEST_CONTAINER=$("${compose[@]}" ps --format json garage | jq -r '.Name')
npm run test --workspace @chatforge/api -- test/storage.integration.test.ts

web_url=http://127.0.0.1:18980
curl --fail --silent --show-error --max-time 10 -D "$work/headers" "$web_url/" -o "$work/index"
for header in content-security-policy strict-transport-security x-content-type-options x-frame-options; do
  grep -qi "^$header:" "$work/headers"
done
test "$(curl --silent --output /dev/null --write-out '%{http_code}' "$web_url/.git/config")" = 403
test "$(curl --silent --output /dev/null --write-out '%{http_code}' "$web_url/api/me")" = 401
invalid_auth="Bearer $(openssl rand -hex 16)"
test "$(curl --silent --output /dev/null --write-out '%{http_code}' -H "Authorization: $invalid_auth" "$web_url/api/me")" = 401
asset=$(sed -n 's/.*src="\(\/assets\/[^" ]*\.js\)".*/\1/p' "$work/index" | head -1)
test -n "$asset"
curl --fail --silent --show-error --max-time 10 -D "$work/asset-headers" "$web_url$asset" -o /dev/null
grep -qi '^content-security-policy:' "$work/asset-headers"

"${compose[@]}" exec -T postgres psql -U chatforge -d chatforge -v ON_ERROR_STOP=1 -qc \
  "CREATE TABLE ci_restart_check (value text NOT NULL); INSERT INTO ci_restart_check VALUES ('persisted');"
"${compose[@]}" stop api web
"${compose[@]}" restart postgres
"${compose[@]}" up --detach --wait --wait-timeout 120
test "$("${compose[@]}" exec -T postgres psql -U chatforge -d chatforge -Atqc 'SELECT value FROM ci_restart_check')" = persisted
test "$("${compose[@]}" exec -T postgres psql -U chatforge -d chatforge -Atqc 'SELECT count(*) FROM drizzle.__drizzle_migrations')" -ge 13
test "$(curl --silent --output /dev/null --write-out '%{http_code}' "$web_url/api/me")" = 401
"${compose[@]}" exec -T postgres psql -U chatforge -d chatforge -v ON_ERROR_STOP=1 -qc 'DROP TABLE ci_restart_check'
echo 'Runtime isolation, migrations, storage contract, security headers and persistence passed.'
