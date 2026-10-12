#!/usr/bin/env bash
# Retry only transient Cloudflare API failures, never a stale tested commit.
set -euo pipefail
log="$(mktemp)"
trap 'rm -f "$log"' EXIT

for ((attempt=1;attempt<=3;attempt++)); do
  if [[ "$GITHUB_EVENT_NAME" == "workflow_run" ]]; then
    if [[ ! "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]]; then
      echo "::error::Unverified CI revision" >&2
      exit 1
    fi
    current="$(git ls-remote origin refs/heads/main | cut -f1)"
    if [[ ! "$current" =~ ^[0-9a-f]{40}$ || "$current" != "$EXPECTED_SHA" ]]; then
      echo "::error::main changed or could not be verified. Refusing stale deployment." >&2
      exit 1
    fi
  fi
  echo "::group::Wrangler deploy attempt $attempt/3"
  if npx wrangler deploy --keep-vars 2>&1 | tee "$log"; then
    echo "::endgroup::"
    echo "Worker deployment succeeded on attempt $attempt."
    exit 0
  else
    code=$?
  fi
  echo "::endgroup::"
  if ! grep -Eiq '(502 Bad Gateway|503 Service Unavailable|504 Gateway Timeout|429 Too Many Requests|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|Received a malformed response from the API)' "$log"; then
    echo "::error::Wrangler returned a non-transient failure, no retry." >&2
    exit "$code"
  fi
  if ((attempt==3)); then
    echo "::error::Cloudflare API still unavailable after 3 attempts." >&2
    exit "$code"
  fi
  delay=$((attempt==1?15:45))
  echo "::warning::Transient Cloudflare API failure. Retrying after $delay seconds, verifying main again."
  sleep "$delay"
done
