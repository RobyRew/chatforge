#!/usr/bin/env bash
# Refuses a chat-converter tag unless chat-converter's CI ran its `test` job on the tag's commit and that job
# passed (ADR-0035). bump-chat-converter.yml runs it before moving the pins; on acceptance it writes the commit to
# $GITHUB_OUTPUT as `sha`, and the job then requires package-lock.json to resolve that same commit.
#
#   infra/ci/converter-tests-passed.sh vX.Y.Z
#
# chat-converter's build-image.yml runs the job on pushes to main and on v* tag pushes. Each workflow run is its
# own check suite, so one commit can carry several runs; within a suite only the newest attempt counts (a re-run
# adds its attempt to the same suite). The tag is accepted when no newest attempt is still queued or running, at
# least one concluded success, and none concluded anything else: cancelled, skipped, neutral, stale and
# action_required (a run waiting for approval) carry no verdict, and every other conclusion, failure and timed_out
# included, refuses the tag. While a run is queued or running, or before any run exists, the script polls until
# WAIT_SECONDS have passed.
#
# Env: GH_TOKEN for gh (the check runs of a public repository need no permission), CONVERTER_REPO (default
# RobyRew/chat-converter), CHECK_NAME (default test), WAIT_SECONDS (default 600), POLL_SECONDS (default 20).
set -euo pipefail

tag=${1:-}
repo=${CONVERTER_REPO:-RobyRew/chat-converter}
check=${CHECK_NAME:-test}
wait_seconds=${WAIT_SECONDS:-600}
poll_seconds=${POLL_SECONDS:-20}

if [[ ! "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "::error::Expected a vX.Y.Z tag, got '$tag'"
  exit 2
fi

# An annotated tag names its commit on the peeled ^{} line; a lightweight tag names the commit itself.
refs=$(git ls-remote "https://github.com/$repo.git" "refs/tags/$tag" "refs/tags/$tag^{}")
sha=$(awk -v ref="refs/tags/$tag^{}" '$2 == ref { print $1 }' <<<"$refs")
[[ -n "$sha" ]] || sha=$(awk -v ref="refs/tags/$tag" '$2 == ref { print $1 }' <<<"$refs")
if [[ ! "$sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "::error::$repo has no tag $tag"
  exit 1
fi
echo "$repo $tag is commit $sha"

deadline=$((SECONDS + wait_seconds))
while :; do
  # One line per check suite: status, conclusion and URL of the newest attempt of the job.
  runs=$(gh api --method GET "repos/$repo/commits/$sha/check-runs" \
    -f check_name="$check" -f filter=all -F per_page=100 --jq '
      if .total_count > 100 then error("more than 100 check runs; this script reads one page") else . end
      | [.check_runs[] | select(.app.slug == "github-actions")]
      | group_by(.check_suite.id) | map(max_by(.id)) | .[]
      | "\(.status) \(.conclusion // "-") \(.html_url)"')
  # Any conclusion outside success and the five without a verdict counts as a failure, unknown ones included.
  failed=$(awk '$1 == "completed" && $2 !~ /^(success|cancelled|skipped|neutral|stale|action_required)$/' <<<"$runs")
  pending=$(awk 'NF && $1 != "completed"' <<<"$runs")
  passed=$(awk '$1 == "completed" && $2 == "success"' <<<"$runs")

  if [[ -n "$failed" ]]; then
    echo "::error::chat-converter's '$check' job did not pass on $tag ($sha)"
    printf '%s\n' "$failed"
    exit 1
  fi
  if [[ -z "$pending" && -n "$passed" ]]; then
    echo "chat-converter's '$check' job passed on $tag ($sha):"
    printf '%s\n' "$passed"
    if [[ -n "${GITHUB_OUTPUT:-}" ]]; then echo "sha=$sha" >>"$GITHUB_OUTPUT"; fi
    exit 0
  fi
  if ((SECONDS >= deadline)); then
    if [[ -n "$pending" ]]; then
      echo "::error::chat-converter's '$check' job was still queued or running on $tag ($sha) after ${wait_seconds}s"
      printf '%s\n' "$pending"
    else
      echo "::error::chat-converter's CI has no '$check' run that passed or failed on $tag ($sha); its build-image.yml runs that job on pushes to main and on v* tags"
      if [[ -n "$runs" ]]; then printf '%s\n' "$runs"; fi
    fi
    exit 1
  fi
  sleep "$poll_seconds"
done
