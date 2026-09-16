#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ] || [ "$1" != "--yes" ]; then
  printf 'Usage: %s --yes BACKUP_DIRECTORY\n' "$0" >&2
  printf 'Restore replaces the current database and stored attachments.\n' >&2
  exit 2
fi

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backup_dir="$(cd "$2" && pwd)"
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
for file in mongo.archive.gz objects.tar.gz SHA256SUMS; do
  if [ ! -f "${backup_dir}/${file}" ]; then
    printf 'Missing backup file: %s\n' "${backup_dir}/${file}" >&2
    exit 1
  fi
done

(
  cd "${backup_dir}"
  shasum -a 256 -c SHA256SUMS
)

restart_services() {
  "${compose[@]}" up -d backend web >/dev/null
}
"${compose[@]}" stop web backend >/dev/null
# A failed restore must leave writers stopped until the operator retries.
trap 'printf "Restore failed; backend and web remain stopped. Fix the error and retry the restore.\n" >&2' ERR

if "${compose[@]}" exec -T mongo sh -c '[ -n "${MONGO_INITDB_ROOT_USERNAME:-}" ]'; then
  "${compose[@]}" exec -T mongo sh -c '
    exec mongorestore --archive --gzip --drop \
      --username "$MONGO_INITDB_ROOT_USERNAME" \
      --password "$MONGO_INITDB_ROOT_PASSWORD" \
      --authenticationDatabase admin
  ' < "${backup_dir}/mongo.archive.gz"
else
  "${compose[@]}" exec -T mongo mongorestore --archive --gzip --drop \
    < "${backup_dir}/mongo.archive.gz"
fi

"${compose[@]}" run --rm --no-deps -T backend \
  python maintenance.py restore-objects --replace \
  < "${backup_dir}/objects.tar.gz"

trap - ERR
restart_services
printf 'Restore completed from %s\n' "${backup_dir}"
