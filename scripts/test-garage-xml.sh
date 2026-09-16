#!/usr/bin/env bash
# Isolated XML + HTTP/2 hardened source build. No LaunchPad data volumes are used.
set -euo pipefail
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
trial_dir="$(mktemp -d /tmp/launchpad-garage-xml.XXXXXX)"
git clone --quiet --depth 1 --branch v2.4.1 https://git.deuxfleurs.fr/Deuxfleurs/garage.git "${trial_dir}/source"
test "$(git -C "${trial_dir}/source" rev-parse HEAD)" = 268334bd2530fa99f8b06c7383b2e9f776691edd
git -C "${trial_dir}/source" apply --check "${project_root}/docker/garage/xml-hardening.patch"
git -C "${trial_dir}/source" apply "${project_root}/docker/garage/xml-hardening.patch"
git -C "${trial_dir}/source" apply --check "${project_root}/docker/garage/h2-hardening.patch"
git -C "${trial_dir}/source" apply "${project_root}/docker/garage/h2-hardening.patch"
printf 'Patched source retained at %s\n' "${trial_dir}/source"
docker run --rm --cpus 2 --memory 3g \
  -v "${trial_dir}/source:/src" \
  -v launchpad_garage_xml_cargo:/usr/local/cargo/registry \
  -v launchpad_garage_xml_target:/target \
  -w /src \
  -e CARGO_TARGET_DIR=/target -e CARGO_BUILD_JOBS=2 \
  -e CARGO_PROFILE_DEV_DEBUG=0 -e CARGO_PROFILE_TEST_DEBUG=0 \
  -e CARGO_PROFILE_DEV_INCREMENTAL=false -e CARGO_PROFILE_TEST_INCREMENTAL=false \
  rust:1.94-slim-bookworm@sha256:cf9dd0ec73e75f827fe59123fff9dc65af1a1c8363c3c31ee8d7f8ad0b6a5fb2 \
  sh -c 'apt-get update && apt-get install -y --no-install-recommends gcc g++ make pkg-config libclang-dev libsodium-dev libsqlite3-dev && cargo test --locked -p garage_api_common -p garage_api_s3 --lib && cargo build --locked -p garage --bin garage'
