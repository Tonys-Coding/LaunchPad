#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${LAUNCHPAD_ENV_FILE:-${project_root}/.env.production}"
if [ ! -f "${env_file}" ]; then
  printf 'Production environment file not found: %s\n' "${env_file}" >&2
  exit 1
fi

compose=(docker compose --env-file "${env_file}" -f compose.yaml -f compose.production.yaml)
cd "${project_root}"
"${compose[@]}" run --rm --no-deps \
  -v "${project_root}/scripts/check-s3-connection.py:/tmp/check-s3-connection.py:ro" \
  backend python /tmp/check-s3-connection.py
