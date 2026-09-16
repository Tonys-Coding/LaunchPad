#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
trial_project="launchpad-concurrency-$(openssl rand -hex 4)"
compose=(docker compose -p "$trial_project" -f compose.concurrency-test.yaml)
cleanup() {
  "${compose[@]}" down
  printf 'Retained test-only volumes: %s_test_data and %s_standalone_data\n' "$trial_project" "$trial_project"
}
trap cleanup EXIT
"${compose[@]}" up -d --wait mongo standalone
"${compose[@]}" run --rm verify
