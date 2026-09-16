# Garage selected-dependency hardening checkpoint

Date: September 14, 2026. **No production migration approved.**

Follow-up: [optimized candidate results](garage-candidate-results.md) record the
release build, isolated S3 trial, runtime packaging, and remaining native coverage.

## Completed

Audited the actual Linux ARM64 normal/build dependency selection for Garage 2.4.1
at commit `268334bd2530fa99f8b06c7383b2e9f776691edd`, with default features and the
previous XML patch. The selected inventory has 281 packages: 267 registry packages
queried against OSV and 14 local workspace packages. The workspace itself still
needs source review; native libraries and other feature/architecture selections
are not covered by this inventory. This is not a compiled-binary SBOM.

Updated selected h2 from 0.4.13 to 0.4.16, the patched release for
[RUSTSEC-2026-0258](https://rustsec.org/advisories/RUSTSEC-2026-0258.html).
The advisory describes unbounded empty HTTP/2 DATA frames and rates it low severity.
No TLS settings, request validation, metrics, or other features were disabled.
Cargo initially changed several unrelated resolution edges; those changes were
reverted, and the targeted lockfile passed subsequent `--offline --locked` builds.
Only quick-xml and h2 versions/checksums and their references differ from upstream.

Saved [h2 patch](../docker/garage/h2-hardening.patch), applied after the
[XML patch](../docker/garage/xml-hardening.patch). Both patches pass reverse-apply
checks against the tested source. `bash scripts/test-garage-xml.sh` now reproduces
the combined candidate from a verified fresh upstream checkout.

## Verification

- Common API: **32 tests passed**; S3 API: **36 tests passed**.
- Server development-profile build succeeded; binary `--version` succeeded.
- Features retained: bundled-libs, k2v, lmdb, metrics, sqlite.
- Six offline audit-tool regression tests passed, covering missing/stale/empty or
  malformed inventories, duplicate entries, and ambiguous source identities.
- Repeatable build script passes shell syntax validation.
- Updated lock SHA-256:
  `05efd3bd2c2adc60b9e93f5fd2621b743407576728c35d98cb30b2401f7603a4`.

The read-only OSV audit now accepts a local patched lockfile and a captured resolved
inventory, rejects mismatches, and records their hashes and coverage. It retains
severity vectors, details, affected ranges, aliases, and withdrawn status instead
of filtering only by severity labels. The captured inventory must still be taken
from the intended build; validating its entries cannot prove its completeness.

## Fresh audit results and remaining review

[Before h2 update](garage-selected-before-hardening-osv.json): six raw matches.
[After update](garage-selected-hardened-osv.json): five raw matches, representing
four distinct issues. [Selected inventory](garage-hardened-build-dependencies.txt).

| Selected dependency | Remaining finding | Disposition |
| --- | --- | --- |
| protobuf 2.28.0 | GHSA-2gh3-rmm4-6rq5 / RUSTSEC-2024-0437, moderate parser recursion issue | Open applicability/remediation review; two aliases of one issue |
| paste 1.0.15 | RUSTSEC-2024-0436 | Unmaintained dependency notice; retained visibly |
| proc-macro-error 1.0.4 | RUSTSEC-2024-0370 | Unmaintained dependency notice; retained visibly |
| structopt 0.3.26 | RUSTSEC-2022-0104 | Maintenance-mode notice; retained visibly |

No high/critical advisory matches remain in this selected registry inventory at
the recorded audit time. That is **not** a clean container/security release gate.
The full workspace lockfile still includes vulnerable dependencies for other
targets/features; these have not been silently removed or globally suppressed.

The [protobuf advisory](https://rustsec.org/advisories/RUSTSEC-2024-0437.html)
requires parsing untrusted protobuf input and lists 3.7.2 as fixed. The reviewed
Garage metrics handler (`src/api/admin/special.rs`) gathers metrics and writes them
with `TextEncoder`; it does not demonstrate an incoming protobuf decoder. This is
useful evidence, not yet a complete reachability analysis or approved exception.
Do not force protobuf 2 to 3 without updating its parent dependencies and testing.

## Next checkpoint

Review the remaining protobuf path, then package and test the exact hardened
candidate against the isolated S3/backup/restore trial and scan its runtime/native
dependencies. An optimized release image, adequate source/SBOM coverage, and the
single-server topology decision remain required before replacing MinIO.

The stopped `launchpad-garage-h2-build` container retains successful build/test logs.
It used the pinned Rust 1.94 builder and the existing isolated Cargo caches/source
mounts; no user data volumes were mounted. LaunchPad's running storage is unchanged.
Host free disk space was about 4.3 GiB at completion: check capacity before the
larger release-image build. Do not delete application volumes to recover space.
