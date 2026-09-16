#!/usr/bin/env bash
set -euo pipefail
umask 077

if [ "$#" -ne 2 ] || [ "$1" != "--yes" ]; then
  printf 'Usage: %s --yes ENCRYPTED_BACKUP_FILE\n' "$0" >&2
  exit 2
fi

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${LAUNCHPAD_ENV_FILE:-${project_root}/.env.production}"
encrypted_file="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"
if [ ! -f "${env_file}" ] || [ ! -f "${encrypted_file}" ]; then
  printf 'Environment file or encrypted backup is missing\n' >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${env_file}"
set +a
: "${BACKUP_ENCRYPTION_KEY:?Set BACKUP_ENCRYPTION_KEY in .env.production}"

if [ -f "${encrypted_file}.sha256" ]; then
  (cd "$(dirname "${encrypted_file}")" && shasum -a 256 -c "$(basename "${encrypted_file}").sha256")
fi

temporary_root="$(mktemp -d)"
cleanup() { rm -rf "${temporary_root}"; }
trap cleanup EXIT
openssl enc -d -aes-256-cbc -pbkdf2 -iter 250000 \
  -pass env:BACKUP_ENCRYPTION_KEY -in "${encrypted_file}" \
  | tar -C "${temporary_root}" -xzf -

LAUNCHPAD_PRODUCTION=true LAUNCHPAD_ENV_FILE="${env_file}" \
  "${project_root}/scripts/restore.sh" --yes "${temporary_root}/snapshot"
