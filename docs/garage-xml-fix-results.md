# Garage XML patch: build and test results

The isolated source patch is implemented and verified. The running LaunchPad
storage remains MinIO; this step does not approve a production migration.

Follow-up: [selected dependency hardening](garage-selected-hardening-results.md)
adds the HTTP/2 patch and a fresh resolved-inventory audit. The repeatable script
below now applies both patches; this document records the earlier XML-only result.

## Implemented

- Base: Garage 2.4.1, commit `268334bd2530fa99f8b06c7383b2e9f776691edd`.
- Changed quick-xml from 0.39.2 to exactly 0.41.0. Cargo.lock changed only that
  package's version and checksum; no other dependencies were updated.
- Added three regression checks: reject excessive namespace declarations, retain
  the attribute iterator's duplicate checking, and process 25,000 unique attributes
  within a ten-second test budget. The last check exercises both attribute checking
  and deserialization on less than 1 MB of input.
- Preserved the existing serializer/deserializer configuration. The initial test
  assumed deserialization rejects duplicate unknown attributes; that assumption was
  incorrect. The final test targets the library's explicit attribute-checking API.

Exact change: [xml-hardening.patch](../docker/garage/xml-hardening.patch).
Repeat with `bash scripts/test-garage-xml.sh`.

## Verification

- Garage common API library: **32 tests passed**.
- Garage S3 API library: **36 tests passed**.
- Those tests cover the existing XML/CORS/lifecycle/website serialization and
  parsing cases along with the three new checks. They are library tests, not the
  complete network integration suite.
- Server binary built successfully and `--version` ran successfully on Linux ARM64.
- Rust builder pinned to
  `rust:1.94-slim-bookworm@sha256:cf9dd0ec73e75f827fe59123fff9dc65af1a1c8363c3c31ee8d7f8ad0b6a5fb2`.
- Verified default features: bundled-libs, k2v, lmdb, metrics, sqlite.
- Updated lockfile SHA-256:
  `4125decf8866bb51df91e7784ab79ee17ffe9ad9327a48ef909a4d0ce258e0b1`.
- A fresh OSV package query returned no advisory matches for quick-xml 0.41.0.

This was a **development-profile verification build**, not the final optimized
production image. Native build packages came from the Debian package repositories;
the builder digest alone does not make those package installs reproducible.

## Certificate dependency result

Cargo's resolved normal/build graph for this ARM64 default-feature server build
contains quick-xml 0.41.0 through the S3/common API crates. An inverse query for
rustls-webpki 0.101.7 returned no path. This confirms the old webpki dependency is
not selected in this tested server graph; it remains in the workspace lockfile
for other targets such as integration-test tooling.

The [resolved dependency inventory](garage-xml-build-dependencies.txt) is retained.
It is not a binary SBOM and does not cover unselected optional features, other
architectures, or native library internals. Other advisory review items remain open.

## Retained artifacts and next step

The stopped `launchpad-garage-xml-build` container retains the build log. Cargo cache
and compiled outputs are in `launchpad_garage_xml_cargo` and
`launchpad_garage_xml_target`. Patched source is at
`/tmp/launchpad-garage-audit.FbQlsc/source`. These are development artifacts; no user
data volumes were attached. The repeatable script uses a fresh source checkout and
shared compilation caches, and verifies the base commit before applying the patch.

Next: audit the resolved server inventory, apply any additional required compatible
updates, and produce the optimized candidate image for the isolated S3 trial and
container scan. The single-server topology decision and the other LaunchPad release
gates remain unresolved. No finding was hidden or suppressed to obtain these results.
