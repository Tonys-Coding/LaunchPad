#!/usr/bin/env bash
# Isolated source build and packaging. Does not deploy or attach user data.
set -euo pipefail
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
case "$(docker info --format '{{.Architecture}}')" in
  aarch64|arm64) ;;
  *) printf 'This candidate recipe is verified for Linux ARM64 only.\n' >&2; exit 1 ;;
esac
candidate_dir="$(mktemp -d /tmp/launchpad-garage-candidate.XXXXXX)"
builder_name="launchpad-garage-release-$(openssl rand -hex 4)"
rust_image='rust:1.94-slim-bookworm@sha256:cf9dd0ec73e75f827fe59123fff9dc65af1a1c8363c3c31ee8d7f8ad0b6a5fb2'
printf 'Source and release artifacts will be retained in %s\n' "$candidate_dir"
git clone --quiet --depth 1 --branch v2.4.1 https://git.deuxfleurs.fr/Deuxfleurs/garage.git "$candidate_dir/source"
test "$(git -C "$candidate_dir/source" rev-parse HEAD)" = 268334bd2530fa99f8b06c7383b2e9f776691edd
for patch_name in xml-hardening.patch h2-hardening.patch sqlite-defensive.patch; do
  git -C "$candidate_dir/source" apply --check "$project_root/docker/garage/$patch_name"
  git -C "$candidate_dir/source" apply "$project_root/docker/garage/$patch_name"
done
docker run --name "$builder_name" --cpus 2 --memory 3g \
  -v "$candidate_dir/source:/src" \
  -v launchpad_garage_xml_cargo:/usr/local/cargo/registry \
  -v launchpad_garage_xml_target:/target -w /src \
  -e CARGO_TARGET_DIR=/target -e CARGO_BUILD_JOBS=2 \
  -e CARGO_PROFILE_DEV_DEBUG=0 -e CARGO_PROFILE_TEST_DEBUG=0 \
  -e CARGO_PROFILE_DEV_INCREMENTAL=false -e CARGO_PROFILE_TEST_INCREMENTAL=false \
  "$rust_image" sh -c \
  'apt-get update && apt-get install -y --no-install-recommends make g++ pkg-config libclang-dev libsodium-dev libsqlite3-dev && cargo test --locked -p garage_api_common -p garage_api_s3 --lib && cargo test --locked --release -p garage_db --features bundled-libs --lib && cargo build --locked --release -p garage --bin garage && /target/release/garage --version && sha256sum /target/release/garage'
mkdir -p "$candidate_dir/artifacts/data"
docker cp "$builder_name:/target/release/garage" "$candidate_dir/artifacts/garage"
cp "$candidate_dir/source/Cargo.lock" "$candidate_dir/source/LICENSE" "$candidate_dir/artifacts/"
cp "$project_root/docker/garage/xml-hardening.patch" "$project_root/docker/garage/h2-hardening.patch" "$project_root/docker/garage/sqlite-defensive.patch" "$candidate_dir/artifacts/"
docker build --provenance=mode=max --sbom=true \
  -f "$project_root/docker/garage/Dockerfile.candidate" \
  -t launchpad-garage-candidate:2.4.1-xml-h2-defensive "$candidate_dir/artifacts"
docker run --rm --network none launchpad-garage-candidate:2.4.1-xml-h2-defensive --version
printf 'Candidate built; no deployment performed. Builder logs: %s\n' "$builder_name"
printf 'Run isolated trial with GARAGE_TRIAL_IMAGE set to the candidate image ID.\n'
