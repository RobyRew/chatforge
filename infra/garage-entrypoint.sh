#!/bin/sh
# Provision one bucket-scoped application key; never grant S3 bucket administration.
set -eu
: "${S3_ACCESS_KEY:?required}" "${S3_SECRET_KEY:?required}" "${S3_BUCKET:?required}"
: "${GARAGE_RPC_SECRET:?required}"
umask 077
rm -f /tmp/garage-ready
/garage server --single-node &
server_pid=$!
cleanup() {
  rm -f /tmp/garage-ready
  kill -TERM "$server_pid" 2>/dev/null || true
  wait "$server_pid" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 0' INT TERM
attempt=0
until /garage status >/dev/null 2>&1; do
  kill -0 "$server_pid" 2>/dev/null || exit 1
  attempt=$((attempt + 1))
  [ "$attempt" -lt 40 ] || { echo 'Storage readiness timed out' >&2; exit 1; }
  sleep 1
done
# CLI output may include credential material. Never stream it to container logs.
provision() {
  if ! /garage key info "$S3_ACCESS_KEY" >/dev/null 2>&1; then
    /garage key import --yes -n chatforge "$S3_ACCESS_KEY" "$S3_SECRET_KEY" || return 1
  fi
  if ! /garage bucket info "$S3_BUCKET" >/dev/null 2>&1; then
    /garage bucket create "$S3_BUCKET" || return 1
  fi
  /garage key deny --create-bucket "$S3_ACCESS_KEY" || return 1
  /garage bucket deny --owner --key "$S3_ACCESS_KEY" "$S3_BUCKET" || return 1
  /garage bucket allow --read --write --key "$S3_ACCESS_KEY" "$S3_BUCKET"
}
if ! provision >/dev/null 2>&1; then
  echo 'Storage provisioning failed; inspect configuration without printing secrets' >&2
  exit 1
fi
touch /tmp/garage-ready
wait "$server_pid"
