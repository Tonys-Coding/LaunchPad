#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="${1:-${project_root}/backups/${timestamp}}"
compose=(docker compose)
if [ -n "${LAUNCHPAD_ENV_FILE:-}" ]; then
  compose+=(--env-file "${LAUNCHPAD_ENV_FILE}")
fi
if [ "${LAUNCHPAD_PRODUCTION:-false}" = "true" ]; then
  compose+=(-f compose.yaml -f compose.production.yaml)
fi
if [ -n "${LAUNCHPAD_COMPOSE_OVERRIDE:-}" ]; then
  compose+=(-f "${LAUNCHPAD_COMPOSE_OVERRIDE}")
fi

cd "${project_root}"
mkdir -p "${backup_dir}"

# Freeze application writes across the database and attachment snapshots.
# The one-off maintenance container can still read storage while the API is stopped.
if [ "${LAUNCHPAD_PRODUCTION:-false}" = "true" ]; then
  restart_services() { "${compose[@]}" up -d backend web >/dev/null; }
  trap restart_services EXIT
  "${compose[@]}" stop web backend >/dev/null
fi

"${compose[@]}" exec -T mongo sh -c '
  if [ -n "${MONGO_INITDB_ROOT_USERNAME:-}" ]; then
    exec mongodump --archive --gzip --db "${MONGO_DATABASE:-launchpad}" \
      --username "$MONGO_INITDB_ROOT_USERNAME" \
      --password "$MONGO_INITDB_ROOT_PASSWORD" \
      --authenticationDatabase admin
  fi
  exec mongodump --archive --gzip --db "${MONGO_DATABASE:-launchpad}"
' > "${backup_dir}/mongo.archive.gz"

"${compose[@]}" run --rm --no-deps -T backend python maintenance.py export-objects \
  > "${backup_dir}/objects.tar.gz"

(
  cd "${backup_dir}"
  shasum -a 256 mongo.archive.gz objects.tar.gz > SHA256SUMS
)

printf 'Backup written to %s\n' "${backup_dir}"
