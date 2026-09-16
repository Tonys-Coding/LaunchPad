#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${LAUNCHPAD_ENV_FILE:-${project_root}/.env.production}"
set -a
# shellcheck disable=SC1090
source "${env_file}"
set +a

failures=()
health_url="https://${LAUNCHPAD_DOMAIN:?Set LAUNCHPAD_DOMAIN}/api/health"
if ! curl --fail --silent --show-error --max-time 15 "${health_url}" >/dev/null; then
  failures+=("public health check failed")
fi

compose=(docker compose --env-file "${env_file}" -f compose.yaml -f compose.production.yaml)
for service in mongo backend web; do
  container_id="$(cd "${project_root}" && "${compose[@]}" ps -q "${service}")"
  if [ -z "${container_id}" ] || [ "$(docker inspect -f '{{.State.Running}}' "${container_id}" 2>/dev/null || true)" != "true" ]; then
    failures+=("${service} is not running")
    continue
  fi
  health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${container_id}")"
  if [ "${health}" = "unhealthy" ]; then failures+=("${service} is unhealthy"); fi
  restarts="$(docker inspect -f '{{.RestartCount}}' "${container_id}")"
  if [ "${restarts}" -gt 0 ]; then failures+=("${service} has restarted unexpectedly (${restarts} times)"); fi
done

disk_used="$(df -Pk "${project_root}" | awk 'NR==2 {gsub(/%/, "", $5); print $5}')"
if [ "${disk_used}" -ge 85 ]; then failures+=("server disk usage is ${disk_used}%"); fi

if command -v rclone >/dev/null && [ -n "${BACKUP_REMOTE:-}" ]; then
  recent_backup="$(rclone lsf "${BACKUP_REMOTE%/}/daily" --max-age 26h --include '*.tar.gz.enc' 2>/dev/null | head -1 || true)"
  if [ -z "${recent_backup}" ]; then failures+=("no successful off-server backup in the last 26 hours"); fi
else
  failures+=("off-server backup monitoring is not configured")
fi

if [ "${#failures[@]}" -gt 0 ]; then
  message="LaunchPad production check failed: $(IFS='; '; echo "${failures[*]}")"
  printf '%s\n' "${message}" >&2
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    escaped="${message//\"/\\\"}"
    curl --fail --silent --show-error --max-time 15 -X POST -H 'Content-Type: application/json' \
      --data "{\"text\":\"${escaped}\"}" "${ALERT_WEBHOOK_URL}" >/dev/null || true
  fi
  exit 1
fi
printf 'LaunchPad production checks passed\n'
