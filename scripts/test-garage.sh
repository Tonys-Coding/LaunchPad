#!/usr/bin/env bash
# Run a new isolated stack each time; keep test volumes but remove containers.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
export TRIAL_RPC_SECRET="$(openssl rand -hex 32)"
export TRIAL_ACCESS_KEY="GK$(openssl rand -hex 16)"
export TRIAL_SECRET_KEY="$(openssl rand -hex 32)"
trial_project="launchpad-garage-trial-$(openssl rand -hex 4)"
compose=(docker compose -p "$trial_project" -f compose.garage-trial.yaml)
cleanup() {
  "${compose[@]}" down
  printf 'Retained dummy-data volume: %s_trial_data\n' "$trial_project"
}
trap cleanup EXIT
"${compose[@]}" up -d garage
"${compose[@]}" run --rm --no-deps verify
