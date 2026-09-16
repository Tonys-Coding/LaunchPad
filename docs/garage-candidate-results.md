# Optimized Garage candidate: package, scan, and S3 trial

Verified September 15, 2026. **Compatibility checkpoint passed; production migration
not yet approved. Running LaunchPad still uses its existing storage.**

Follow-up: the [native review and SQLite safeguard](garage-native-review.md) includes
a newer tested image with defensive database initialization. The image hashes in
this document record the earlier XML/h2-only candidate, not that newer artifact.

## Exact artifact

- Garage 2.4.1 source `268334bd2530fa99f8b06c7383b2e9f776691edd`, with the saved
  XML and HTTP/2 patches; default features retained.
- Upstream release profile: optimization level 3, thin LTO, 16 codegen units,
  debug-info stripping. Build completed successfully in 6 minutes 16 seconds.
- Linux ARM64 binary SHA-256:
  `ba92b0af78855e9139998f7014ec9ec1c24eb09a0c41b4eff87b16e1036cfdeb`.
- Lockfile SHA-256:
  `05efd3bd2c2adc60b9e93f5fd2621b743407576728c35d98cb30b2401f7603a4`.
- Final local image: `launchpad-garage-candidate:2.4.1-xml-h2-minimal`.
- Image index ID:
  `sha256:ba920f80758dcf1f93f6f0b525eb104e7f63da2bb52a2d8ce3abef8df74ce81d`.
- ARM64 image manifest:
  `sha256:c1e52347da08dedf2c1c4018ec39c06ff077a7254358a4946bf01a71a0bda9f5`.

The binary's dynamic dependencies are libgcc, libc, libm, and the dynamic loader.
The first packaging attempt used the broader distroless C++ image and reported
one high zlib finding plus eight low findings. The final package instead uses
the pinned distroless base-nossl image plus the required libgcc from the pinned
C++ image. The libgcc/gcc package metadata and licensing are copied with it.
OpenSSL, zlib, and other unused C++ runtime libraries are not carried into the
final image. No library version metadata was stripped to conceal a finding.

It runs as UID/GID 65532, with no shell/package manager. The trial drops all
capabilities, prevents privilege escalation, publishes no ports, and uses an
isolated internal network. This is not a production cluster configuration.

## Verification

Both the initial and final images passed the existing real-SDK trial. The final
trial used its immutable image ID and eight generated dummy objects:

- Put/get/head and list pagination, exact SHA-256 hashes and content types.
- Empty files, Unicode/spaces in names, and a 10,485,760-byte attachment.
- Anonymous and invalid-signature reads/writes rejected.
- Delete, export all objects, restore with replacement, and exact content checks.
- Restored archive: 10,489,598 bytes. Extra data created after backup was removed
  by the replacement restore, and restored contents matched the original set.

SDK versions were boto3 1.43.64 and botocore 1.43.93, from the existing LaunchPad
production-backend image. This is an S3/object-archive trial, not the complete
MongoDB/off-server encrypted production restore drill. Application user-isolation
and concurrent-write tests are separate release gates.

The earlier patched-source API suites passed 68 tests. Those test results remain
valid evidence for that source revision; this step additionally tested its
optimized binary over the network. It did not run Garage's entire upstream suite.

## Scan results and coverage

Docker Scout 1.24.0 scanned without excluding unfixed vulnerabilities or filtering
severity. Raw results are retained:

| Package attempt | SBOM packages | Critical | High | Medium | Low |
| --- | ---: | ---: | ---: | ---: | ---: |
| Initial broader runtime | 14 | 0 | 1 | 0 | 8 |
| Final required-libraries runtime | 9 | 0 | 0 | 0 | 7 |

- [Initial raw scan](garage-candidate-scan.sarif.json) and [SBOM](garage-candidate.sbom.json).
- [Final raw scan](garage-candidate-minimal-scan.sarif.json) and [SBOM](garage-candidate-minimal.sbom.json).
- [Selected Rust dependency audit](garage-selected-hardening-results.md), which
  separately covers 267 selected registry packages and retains unresolved notices.

The final seven low findings are in glibc: CVE-2010-4756, CVE-2018-20796,
CVE-2019-1010022, CVE-2019-1010023, CVE-2019-1010024, CVE-2019-1010025, and
CVE-2019-9192. They are not suppressed. Individual disposition remains review work.

**Important coverage limit:** the image's generated SBOM indexes runtime OS
packages, not the static Rust graph or all native code compiled inside `/garage`.
The included Cargo.lock was retained but did not cause those crates to be indexed
by this image scanner. A separate direct base-image scan indexed 19 packages and
reported none; the attested candidate scans used different inventory metadata.
Do not rely on that earlier base-only result as a complete image clearance.

BuildKit generated packaging provenance and an SBOM attestation. Packaging
provenance alone does not attest the preceding source compilation performed in
a separate container. The pinned source, patches, binary/lock hashes, and retained
build logs supply that additional evidence; a unified release attestation is still
desirable before publishing. Apt build dependencies came from live repositories;
the [captured build package inventory](garage-release-build-packages.txt) records
what was used but is not a reproducible apt snapshot.

## Remaining native-library review

Source inspection identified these bundled libraries not comprehensively covered
by the OS package scan:

- libsodium 1.0.18 inside libsodium-sys 0.2.7.
- SQLite 3.51.1 inside libsqlite3-sys 0.36.0.
- zstd 1.5.7 inside zstd-sys 2.0.16.
- LMDB header version 0.9.70 inside lmdb-master-sys 0.2.6.

The [Debian libsodium advisory](https://lists.debian.org/debian-security-announce/2026/msg00002.html)
documents CVE-2025-69277 and a Debian backport. Installing the patched Debian
build package does **not** establish that the separately bundled copy contains
that fix. Its affected point-validation function was not referenced directly in
Garage's source search, but the transitive calling paths still need review or
a patched-library build. SQLite's [release history](https://www.sqlite.org/news.html)
also has later fixes; evaluate relevant native advisories before approving migration.

For the remaining Rust protobuf issue, the resolved inverse graph leads only to
Prometheus and its OpenTelemetry exporter. Reviewed exporter code constructs
metrics, and Garage writes `TextEncoder` output. Source searches found no protobuf
input parsing call in those reviewed paths. The advisory concerns parsing untrusted
input, but this is not a blanket exception for every feature/target. Keep the
[raw finding](garage-selected-hardened-osv.json) visible.

## Repeat and next action

Build recipe: `bash scripts/build-garage-candidate.sh`. It verifies the source
commit and applies both patches, runs API tests, builds with the release profile,
and packages the binary. The recipe is explicitly ARM64-only; target-platform
validation is required after the real production server is chosen. The components
were executed in this checkpoint, not the entire newly saved script as one call.

Set `GARAGE_TRIAL_IMAGE` to the resulting immutable image ID and run
`bash scripts/test-garage.sh`. The original upstream trial image remains the
default; no application Compose storage service was changed.

Next: close the bundled-native-library review, then make the Garage/MinIO and
single-server topology decision. Quota/import/deletion concurrency, frontend
release coverage, remaining backend findings, real deployment configuration,
and the off-server restore/alert drill all remain incomplete.

Retained artifacts: `/tmp/launchpad-garage-artifact.Vk482i`, stopped builder
`launchpad-garage-release-build`, and dummy trial volumes ending `3530fabd_trial_data`
and `56039207_trial_data`. Trial containers/networks were removed automatically.
Only the isolated debug compilation cache was cleared (1.6 GiB); it can be rebuilt
with the saved script. The optimized binary and release cache remain. No user data
was deleted, migrated, or exported. Host free space was about 4.5 GiB at completion.
