#!/usr/bin/env bash
set -euo pipefail
umask 077

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${LAUNCHPAD_ENV_FILE:-${project_root}/.env.production}"
if [ ! -f "${env_file}" ]; then
  printf 'Production environment file not found: %s\n' "${env_file}" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${env_file}"
set +a

backup_failed() {
  printf 'LaunchPad production backup failed. Check the backup service logs.\n' >&2
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    curl --fail --silent --show-error --max-time 15 -X POST -H 'Content-Type: application/json' \
      --data '{"text":"LaunchPad production backup failed. Check the backup service logs."}' \
      "${ALERT_WEBHOOK_URL}" >/dev/null || true
  fi
}
trap backup_failed ERR

: "${BACKUP_ENCRYPTION_KEY:?Set BACKUP_ENCRYPTION_KEY in .env.production}"
: "${BACKUP_REMOTE:?Set BACKUP_REMOTE in .env.production}"
command -v openssl >/dev/null || { printf 'openssl is required\n' >&2; exit 1; }
command -v rclone >/dev/null || { printf 'rclone is required\n' >&2; exit 1; }

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
temporary_root="$(mktemp -d)"
plain_dir="${temporary_root}/snapshot"
local_dir="${project_root}/backups/production"
archive_name="launchpad-${timestamp}.tar.gz.enc"
encrypted_file="${local_dir}/${archive_name}"
cleanup() { rm -rf "${temporary_root}"; }
trap cleanup EXIT

mkdir -p "${local_dir}"
LAUNCHPAD_PRODUCTION=true LAUNCHPAD_ENV_FILE="${env_file}" \
  "${project_root}/scripts/backup.sh" "${plain_dir}"

tar -C "${temporary_root}" -czf - snapshot \
  | openssl enc -aes-256-cbc -salt -pbkdf2 -iter 250000 \
      -pass env:BACKUP_ENCRYPTION_KEY -out "${encrypted_file}"
(cd "${local_dir}" && shasum -a 256 "${archive_name}" > "${archive_name}.sha256")

rclone copyto "${encrypted_file}" "${BACKUP_REMOTE%/}/daily/${archive_name}"
rclone copyto "${encrypted_file}.sha256" "${BACKUP_REMOTE%/}/daily/${archive_name}.sha256"
if [ "$(date -u +%u)" = "7" ]; then
  rclone copyto "${encrypted_file}" "${BACKUP_REMOTE%/}/weekly/${archive_name}"
  rclone copyto "${encrypted_file}.sha256" "${BACKUP_REMOTE%/}/weekly/${archive_name}.sha256"
fi

rclone delete "${BACKUP_REMOTE%/}/daily" --min-age 7d --include 'launchpad-*.tar.gz.enc*'
rclone delete "${BACKUP_REMOTE%/}/weekly" --min-age 28d --include 'launchpad-*.tar.gz.enc*'
find "${local_dir}" -type f -name 'launchpad-*.tar.gz.enc*' -mtime +7 -delete
printf 'Encrypted production backup uploaded: %s\n' "${archive_name}"
