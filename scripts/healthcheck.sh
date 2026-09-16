#!/usr/bin/env bash
set -euo pipefail

port="${LAUNCHPAD_PORT:-8080}"
base_url="${LAUNCHPAD_URL:-http://localhost:${port}}"

health="$(curl --fail --silent --show-error "${base_url}/api/health")"
if [ "${health}" != '{"status":"ok"}' ]; then
  printf 'Unexpected health response: %s\n' "${health}" >&2
  exit 1
fi

curl --fail --silent --show-error "${base_url}/login" >/dev/null
printf 'Launchpad is healthy at %s\n' "${base_url}"
